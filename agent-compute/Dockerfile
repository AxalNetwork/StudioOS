# syntax=docker/dockerfile:1
# D4557: builder tools stay outside the minimal runtime; Linux x86-64 only.
FROM python:3.12.14-trixie@sha256:4d1caded1f729ae443eb803f26ffde7b61e696aeaef62f099abb6dd6b14257c7 AS builder
RUN --mount=type=bind,source=build_image.py,target=/source/build_image.py,readonly \
    --mount=type=bind,source=build_runtime.py,target=/source/build_runtime.py,readonly \
    --mount=type=bind,source=requirements.txt,target=/source/requirements.txt,readonly \
    --mount=type=bind,source=source-lock.json,target=/source/source-lock.json,readonly \
    --mount=type=secret,id=proxy_ca python /source/build_image.py

FROM scratch
COPY --from=builder /runtime/ /
COPY --from=builder /etc/debian_version /etc/debian_version
COPY --chmod=0555 runner.py server.py requirements.txt failureCodes.ts /app/
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 LD_LIBRARY_PATH=/usr/local/lib PATH=/usr/local/bin
WORKDIR /app
USER 10001:10001
EXPOSE 8080
CMD ["/usr/local/bin/python3.12", "/app/server.py"]
