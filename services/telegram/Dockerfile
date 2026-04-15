FROM python:3.11-slim

WORKDIR /app

# Install system deps for telethon/crypto
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Session persistence
VOLUME /app/session

EXPOSE 8020

CMD ["python", "main.py"]
