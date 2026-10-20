// SiliconSmith Verilator testbench for ss_soc.
//
// Plusargs:
//   +firmware=<hex>      firmware image ($readmemh, 32-bit words)
//   +max_cycles=<n>      timeout (default 200M)
//   +profile=<file>      write an instruction-fetch histogram: "<pc_hex> <count>" per line
//   +vcd=<file>          dump a VCD waveform (slow; for debugging/counterexamples)
//
// Prints firmware UART output to stdout, then one machine-readable line:
//   SS_SIM exit=<code> trap=<0|1> timeout=<0|1> sim_cycles=<n>
// Process exit status: 0 on clean exit(0), 1 otherwise.
#include "Vss_soc.h"
#include "verilated.h"
#if VM_TRACE
#include "verilated_vcd_c.h"
#endif
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <unordered_map>
#include <vector>
#include <algorithm>

int main(int argc, char** argv) {
    VerilatedContext* ctx = new VerilatedContext;
    ctx->commandArgs(argc, argv);
    Vss_soc* top = new Vss_soc{ctx};

    uint64_t max_cycles = 200000000ULL;
    if (const char* a = ctx->commandArgsPlusMatch("max_cycles=")) {
        if (std::strlen(a) > 12) max_cycles = std::strtoull(a + 12, nullptr, 10);
    }
    const char* profile_path = nullptr;
    if (const char* a = ctx->commandArgsPlusMatch("profile=")) {
        if (std::strlen(a) > 9) profile_path = a + 9;
    }
#if VM_TRACE
    VerilatedVcdC* vcd = nullptr;
    if (const char* a = ctx->commandArgsPlusMatch("vcd=")) {
        if (std::strlen(a) > 5) {
            ctx->traceEverOn(true);
            vcd = new VerilatedVcdC;
            top->trace(vcd, 99);
            vcd->open(a + 5);
        }
    }
#endif

    std::unordered_map<uint32_t, uint64_t> hist;
    uint64_t cycle = 0;
    int exit_code = -1;
    bool trapped = false, timed_out = false;

    top->clk = 0;
    top->resetn = 0;
    top->eval();
    while (true) {
        if (cycle == 16) top->resetn = 1;
        top->clk = 1;
        top->eval();
#if VM_TRACE
        if (vcd) vcd->dump(cycle * 10);
#endif
        // sample outputs after the rising edge
        if (top->uart_valid) { std::putchar((char)top->uart_data); }
        if (profile_path && top->ifetch_valid) hist[top->ifetch_addr]++;
        if (top->exit_valid) { exit_code = (int)top->exit_code; break; }
        if (top->trap) { trapped = true; break; }
        top->clk = 0;
        top->eval();
#if VM_TRACE
        if (vcd) vcd->dump(cycle * 10 + 5);
#endif
        if (++cycle >= max_cycles) { timed_out = true; break; }
    }
    std::fflush(stdout);

    if (profile_path) {
        std::vector<std::pair<uint32_t, uint64_t>> v(hist.begin(), hist.end());
        std::sort(v.begin(), v.end());
        if (FILE* f = std::fopen(profile_path, "w")) {
            for (auto& kv : v) std::fprintf(f, "%08x %llu\n", kv.first, (unsigned long long)kv.second);
            std::fclose(f);
        }
    }
#if VM_TRACE
    if (vcd) { vcd->close(); delete vcd; }
#endif
    std::printf("SS_SIM exit=%d trap=%d timeout=%d sim_cycles=%llu\n", exit_code, trapped ? 1 : 0,
                timed_out ? 1 : 0, (unsigned long long)cycle);
    top->final();
    delete top;
    delete ctx;
    return (exit_code == 0 && !trapped && !timed_out) ? 0 : 1;
}
