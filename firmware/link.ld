/* ss_soc: 128 KiB unified RAM at 0x0, preloaded from hex (no .data copy needed). */
MEMORY { RAM (rwx) : ORIGIN = 0x00000000, LENGTH = 128K }
ENTRY(_start)
SECTIONS {
	.text : { *(.text.start) *(.text .text.*) } > RAM
	.rodata : ALIGN(4) { *(.rodata .rodata.* .srodata .srodata.*) } > RAM
	.data : ALIGN(4) { *(.data .data.* .sdata .sdata.*) } > RAM
	.bss : ALIGN(4) {
		__bss_start = .;
		*(.bss .bss.* .sbss .sbss.* COMMON)
		. = ALIGN(4);
		__bss_end = .;
	} > RAM
	__stack_top = ORIGIN(RAM) + LENGTH(RAM);
}
