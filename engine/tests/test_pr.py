from pathlib import Path

import pytest

from siliconsmith import paths, pr

CPU = """#if X
TM_INLINE void tm_dot_prod(mtype_t* a, mtype_t* b, uint32_t n, sumtype_t* r)
{ int s = 0; for (;;) { s += 1; } *r = s; }
TM_INLINE void other(void) { }
#endif
"""
PATCHED = """typedef int mtype_t;
TM_INLINE void tm_dot_prod(mtype_t* a, mtype_t* b, uint32_t n, sumtype_t* r)
{ *r = ss_dot4(1, 2); }
"""


def test_only_the_named_function_is_replaced():
    out = pr.build_arch_header(CPU, PATCHED, "tm_dot_prod", ["dot4"])
    assert "ss_dot4(1, 2)" in out and "s += 1" not in out and "void other(void)" in out
    assert out.startswith("/* arch_rv32ss.h") and '#include "ss_intrinsics.h"' in out
    assert "typedef int mtype_t" not in out  # helper typedefs of the patched file are not copied


def test_elif_is_inserted_once_before_rv32p():
    chain = "#elif TM_ARCH==TM_ARCH_RV32P\n    #include \"arch_rv32p.h\"\n"
    once = pr._insert_elif(chain)
    assert once.count("arch_rv32ss.h") == 1 and pr._insert_elif(once) == once


def test_missing_function_is_an_error():
    with pytest.raises(pr.PrError):
        pr.extract_function("int x;", "tm_dot_prod")
