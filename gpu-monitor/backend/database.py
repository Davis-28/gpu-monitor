import os, sqlite3
from contextlib import contextmanager

DB_PATH = os.getenv("DB_PATH", "gpu_metrics.db")
if os.path.dirname(DB_PATH):
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

def init_db():
    with get_conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            machine_id TEXT, gpu_id INTEGER, gpu_name TEXT,
            timestamp TEXT, utilization REAL,
            vram_used_mb INTEGER, vram_free_mb INTEGER, vram_total_mb INTEGER,
            temperature_c INTEGER, power_draw_w INTEGER, power_limit_w INTEGER,
            throughput_tokens_per_sec REAL, latency_ms REAL,
            batch_time_ms REAL, batch_efficiency REAL, error_rate REAL,
            memory_bandwidth_pct REAL, phase TEXT,
            cost_per_hour REAL, efficiency_score REAL,
            cost_this_sample REAL
        );
        CREATE INDEX IF NOT EXISTS idx_ts ON metrics(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_machine ON metrics(machine_id, gpu_id);

        CREATE TABLE IF NOT EXISTS processes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            metric_id INTEGER, machine_id TEXT, gpu_id INTEGER,
            timestamp TEXT, pid INTEGER, name TEXT,
            memory_mb INTEGER, utilization_pct REAL,
            cost_attributed REAL
        );
        CREATE INDEX IF NOT EXISTS idx_proc_ts ON processes(timestamp DESC);

        CREATE TABLE IF NOT EXISTS automation_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT, machine_id TEXT, gpu_id INTEGER,
            action TEXT, reason TEXT, executed INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY, value TEXT
        );
        """)

@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn; conn.commit()
    finally:
        conn.close()
