"""Production entry point:  gunicorn -w 1 --threads 8 --timeout 180 -b 0.0.0.0:5000 wsgi:app
Keep ONE worker: the 24h watchlist thread must run exactly once (threads give you the concurrency)."""
import time
from app import app, init_db, start_watcher

for _ in range(20):   # MySQL in docker-compose can take a few seconds to accept connections
    try: init_db(); break
    except Exception as e: print("waiting for MySQL...", e); time.sleep(3)
start_watcher()
