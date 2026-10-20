/* Tang Nano 9K build: 48 KiB block RAM at 0x0 (same layout as the simulation SoC otherwise). */
MEMORY { RAM (rwx) : ORIGIN = 0x00000000, LENGTH = 48K }
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
