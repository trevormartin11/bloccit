"""
Application settings and configuration.
Uses environment variables with sensible defaults for local development.
"""

import os


DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite:///./wps_buffalo.db",
)

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-in-production")
DEBUG = os.getenv("DEBUG", "true").lower() == "true"
APP_NAME = "WPS Buffalo"
API_VERSION = "v1"
