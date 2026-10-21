To: contree@nebius.com
Subject: Token Factory Sandboxes activation request - Nebius x NVIDIA Global AI Hackathon

Hi Contree team,

I'm building SiliconSmith for the Nebius x NVIDIA Global AI Hackathon (Coding & Agentic
Engineering track). It searches over processor designs: each candidate CPU is verified in its own
Sandboxes branch, forked from its parent's checkpoint image.

My Token Factory API key authenticates, but get_token_info() (contree-sdk 0.3.6) reports every
permission as False, so I can't create or run instances.

Could you enable Sandboxes for this project?

  Project ID: <PASTE NEBIUS_PROJECT_ID FROM .env.local>
  Account email: therayyn16@gmail.com

Intended use: roughly 20-50 concurrent short-lived instances (Ubuntu 24.04 image with Verilator,
Yosys and a RISC-V GCC, ~3 GB), non-disposable runs so child images checkpoint from parents.

Thank you,
<your name>
