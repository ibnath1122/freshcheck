FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY . .
WORKDIR /app/backend
ENV HOST=0.0.0.0 PORT=5000
EXPOSE 5000
CMD ["gunicorn", "-w", "1", "--threads", "8", "--timeout", "180", "-b", "0.0.0.0:5000", "wsgi:app"]
