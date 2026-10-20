# SiliconSmith sandbox image: the toolchain every candidate CPU is built and verified with.
# Built remotely by Token Factory Sandboxes:  contree build . -f sandbox/Dockerfile --tag siliconsmith-base:latest
# (also buildable locally with docker for testing).
FROM ubuntu:24.04

COPY scripts/setup-toolchain.sh /opt/ss/setup-toolchain.sh
RUN bash /opt/ss/setup-toolchain.sh && rm -rf /var/lib/apt/lists/*

ENV PATH=/opt/oss-cad-suite/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ENV PYTHONDONTWRITEBYTECODE=1
ENV SS_ROOT=/work

COPY hw /work/hw
COPY firmware /work/firmware
COPY workloads /work/workloads
COPY engine /work/engine
WORKDIR /work/engine
