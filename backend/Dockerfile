FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    BIFLY_STORAGE_DIR=/data/storage

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY alembic ./alembic
COPY app ./app

# Run as an unprivileged user; uploaded documents go to a volume (S3 in production).
RUN useradd --system --uid 10001 --no-create-home bifly \
    && mkdir -p /data/storage && chown bifly /data/storage
USER bifly

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
