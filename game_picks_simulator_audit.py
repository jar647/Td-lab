#!/usr/bin/env python3
"""Run the actual current bootstrap audit; no obsolete fixed-normal assumptions."""
import subprocess
from pathlib import Path

if __name__ == '__main__':
    subprocess.run(['node', 'audit_nfl_simulator.js'], cwd=Path(__file__).resolve().parent, check=True)
