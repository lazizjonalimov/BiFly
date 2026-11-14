from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FLYFLEET_", env_file=".env", extra="ignore")

    env: str = "development"  # development | test | production

    # Runtime connection. MUST be a non-superuser, non-owner role so row-level security applies.
    database_url: str = "postgresql+psycopg://flyfleet_app:flyfleet_app_dev@localhost:5432/flyfleet"
    # Used only by Alembic (schema owner).
    migration_database_url: str = "postgresql+psycopg://flyfleet_owner:flyfleet_owner_dev@localhost:5432/flyfleet"

    jwt_secret: str = "dev-only-change-me-dev-only-change-me"
    jwt_ttl_minutes: int = 12 * 60
    jwt_issuer: str = "flyfleet"

    # Keys for encrypting sensitive columns (e.g. driver licence numbers), comma-separated. The first key
    # encrypts; every key is tried when decrypting, which is how keys are rotated. Leave empty in development
    # to use a built-in key. Generate one with:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    field_encryption_keys: str = ""

    storage_dir: str = "./.storage"
    max_upload_bytes: int = 15 * 1024 * 1024

    cors_origins: list[str] = ["http://localhost:3000"]
    signup_enabled: bool = True
    # How many active companies one account (profile) may hold. Individual accounts can be given another limit.
    max_companies_per_account: int = 10


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.env == "production":
        if s.jwt_secret.startswith("dev-only"):
            raise RuntimeError("FLYFLEET_JWT_SECRET must be set in production")
        if not s.field_encryption_keys.strip():
            raise RuntimeError("FLYFLEET_FIELD_ENCRYPTION_KEYS must be set in production")
    return s
