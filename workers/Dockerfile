FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY ipa_inspector.py quarantine_worker.py ./
USER 65532:65532
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
# One-shot task: run on a trusted external private scheduler, not a public HTTP service.
CMD ["python", "-I", "/app/quarantine_worker.py"]
