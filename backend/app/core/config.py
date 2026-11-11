from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TMS_", env_file=".env", extra="ignore")

    env: str = "development"  # development | test | production

    # Runtime connection. MUST be a non-superuser, non-owner role so RLS applies.
    database_url: str = "postgresql+psycopg://tms_app:tms_app_dev@localhost:5432/tms"
    # Used only by Alembic / seeding (table owner).
    migration_database_url: str = "postgresql+psycopg://tms_owner:tms_owner_dev@localhost:5432/tms"

    jwt_secret: str = "dev-only-change-me-dev-only-change-me"
    jwt_ttl_minutes: int = 12 * 60
    jwt_issuer: str = "carrier-tms"

    storage_dir: str = "./.storage"
    max_upload_bytes: int = 15 * 1024 * 1024

    cors_origins: list[str] = ["http://localhost:3000"]
    signup_enabled: bool = True


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.env == "production" and s.jwt_secret.startswith("dev-only"):
        raise RuntimeError("TMS_JWT_SECRET must be set in production")
    return s
