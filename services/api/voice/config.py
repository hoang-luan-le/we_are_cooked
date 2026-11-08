import os
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parents[2] / ".env")  # repo-root .env
load_dotenv()                          # or a .env where you run uvicorn

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")
DEEPGRAM_AGENT_URL = os.getenv("DEEPGRAM_AGENT_URL", "wss://agent.deepgram.com/v1/agent/converse")
DANA_MODEL = os.getenv("DANA_MODEL", "gemini-2.5-flash")        # Deepgram-hosted Gemini (voice)
DANA_VOICE = os.getenv("DANA_VOICE", "aura-2-andromeda-en")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")                 # direct Gemini (text fallback)
GEMINI_TEXT_MODEL = os.getenv("GEMINI_TEXT_MODEL", DANA_MODEL)

# "fake" = use fake_facts.json. Otherwise the backend base URL, e.g. http://localhost:8000
DANA_FACTS = os.getenv("DANA_FACTS", "fake")

INPUT_RATE = 16000   # mic audio from the browser
OUTPUT_RATE = 24000  # Dana's audio to the browser

CALLS = ("briefing", "help", "debrief")
LEVELS = ("explore", "practice", "challenge")

LOG_DIR = HERE / "logs"
