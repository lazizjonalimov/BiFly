import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.permissions import Role


class SignupIn(BaseModel):
    organization_name: str = Field(min_length=2, max_length=160)
    full_name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=10, max_length=200)
    dot_number: str | None = Field(default=None, max_length=20)
    mc_number: str | None = Field(default=None, max_length=20)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=200)
    organization_id: uuid.UUID | None = None


class PasswordChangeIn(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: str = Field(min_length=10, max_length=200)


class OrgChoice(BaseModel):
    id: uuid.UUID
    name: str
    role: str


class TokenOut(BaseModel):
    access_token: str | None = None
    token_type: str = "bearer"
    organization: OrgChoice | None = None
    # Present instead of a token when the user belongs to several organizations.
    requires_organization_selection: bool = False
    organizations: list[OrgChoice] = []


class MeOut(BaseModel):
    user_id: uuid.UUID
    email: str
    full_name: str
    role: str
    organization_id: uuid.UUID
    organization_name: str
    permissions: list[str]


class OrganizationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    slug: str
    dot_number: str | None
    mc_number: str | None
    default_payment_terms_days: int


class OrganizationPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    dot_number: str | None = Field(default=None, max_length=20)
    mc_number: str | None = Field(default=None, max_length=20)
    default_payment_terms_days: int | None = Field(default=None, ge=0, le=365)


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=10, max_length=200)
    role: Role


class MemberPatch(BaseModel):
    role: Role | None = None
    active: bool | None = None


class MemberOut(BaseModel):
    user_id: uuid.UUID
    email: str
    full_name: str
    role: str
    active: bool


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    actor_user_id: uuid.UUID | None
    action: str
    entity_type: str
    entity_id: uuid.UUID | None
    data: dict | None
    request_id: str | None
    created_at: datetime
