"""
WPS Buffalo — FastAPI application entry point.

Run with: uvicorn wps_buffalo.api.main:app --reload
"""

from fastapi import FastAPI
from wps_buffalo.config.settings import APP_NAME, API_VERSION

app = FastAPI(
    title=APP_NAME,
    version=API_VERSION,
    description="Internal QA/QCR/AQL risk protection platform for federal prime contractors.",
)


@app.get("/")
def root():
    return {
        "app": APP_NAME,
        "version": API_VERSION,
        "status": "operational",
    }


@app.get("/health")
def health_check():
    return {"status": "healthy"}
