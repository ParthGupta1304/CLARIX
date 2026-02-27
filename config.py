"""Clarix configuration — loaded from environment / .env file."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- LLM provider --------------------------------------------------
    llm_provider: str = "openai"  # "openai" | "azure" | "local"

    # OpenAI
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"

    # Azure OpenAI
    azure_openai_endpoint: str = ""
    azure_openai_api_key: str = ""
    azure_openai_deployment: str = ""

    # Local / Ollama
    local_llm_base_url: str = "http://localhost:11434/v1"
    local_llm_model: str = "llama3"

    # --- Server ---------------------------------------------------------
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "info"

    # --- Integration with Node.js server --------------------------------
    internal_token: str = ""  # shared secret between Node server and this engine
    allowed_origins: str = "*"  # comma-separated origins, e.g. "http://localhost:3000,https://app.example.com"

    # --- Pipeline -------------------------------------------------------
    max_claims: int = 10
    verification_temperature: float = 0.2


settings = Settings()
