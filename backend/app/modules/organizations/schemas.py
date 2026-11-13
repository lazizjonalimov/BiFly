import uuid
from datetime import datetime
from typing import Annotated, Any, Literal
from zoneinfo import available_timezones

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field

from app.core.crud import ListParams
from app.core.permissions import Role


def _valid_timezone(value: str) -> str:
    if value not in available_timezones():
        raise ValueError("Unknown time zone. Use an IANA name such as America/Chicago")
    return value


TimeZone = Annotated[str, Field(max_length=64), AfterValidator(_valid_timezone)]
Password = Annotated[str, Field(min_length=10, max_length=200)]
Short = Annotated[str | None, Field(max_length=40)]


# ---------------------------------------------------------------- sign-in and session
class SignupIn(BaseModel):
    organization_name: str = Field(min_length=2, max_length=160)
    full_name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: Password
    dot_number: str | None = Field(default=None, max_length=20)
    mc_number: str | None = Field(default=None, max_length=20)
    timezone: TimeZone = Field(default="UTC", description="IANA time zone the company operates in")


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=200)
    organization_id: uuid.UUID | None = None


class SwitchIn(BaseModel):
    organization_id: uuid.UUID


class PasswordChangeIn(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: Password


class OrgRef(BaseModel):
    """A company the user can work in."""
    id: uuid.UUID
    name: str
    slug: str
    role: str
    status: str


class SessionOut(BaseModel):
    access_token: str | None = None
    token_type: str = "bearer"
    organization: OrgRef | None = None
    # Set instead of a token when the user belongs to several companies and has not chosen one.
    requires_organization_selection: bool = False
    organizations: list[OrgRef] = []


class MeUser(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str


class MeOrganization(OrgRef):
    timezone: str
    base_currency: str


class MeAccount(BaseModel):
    id: uuid.UUID
    name: str
    is_owner: bool
    max_companies: int


class MeOut(BaseModel):
    user: MeUser
    organization: MeOrganization
    account: MeAccount
    memberships: list[OrgRef]
    permissions: list[str]


# ---------------------------------------------------------------- companies under one account
CopyPart = Literal["team", "terminals", "customers", "drivers", "vehicles", "trailers"]


class CompanyOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    status: str
    dot_number: str | None
    mc_number: str | None
    created_at: datetime


class CompaniesOut(BaseModel):
    account_id: uuid.UUID
    account_name: str
    max_companies: int
    active_count: int
    companies: list[CompanyOut]


class CompanyCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    legal_name: str | None = Field(default=None, max_length=200)
    dot_number: str | None = Field(default=None, max_length=20)
    mc_number: str | None = Field(default=None, max_length=20)
    timezone: TimeZone | None = Field(default=None, description="Defaults to the current company's time zone")
    copy_from: uuid.UUID | None = Field(default=None, description="Another company in this account to copy from")
    include: list[CopyPart] = Field(default_factory=list, description="What to copy from it")


class CompanyCreated(CompanyOut):
    copied: dict[str, int] = {}


# ---------------------------------------------------------------- company settings
class OrganizationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    legal_name: str | None
    slug: str
    status: str
    dot_number: str | None
    mc_number: str | None
    phone: str | None
    email: str | None
    address: str | None
    city: str | None
    state: str | None
    postal_code: str | None
    timezone: str
    base_currency: str
    default_payment_terms_days: int
    load_number_prefix: str
    invoice_number_prefix: str


class OrganizationPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    legal_name: str | None = Field(default=None, max_length=200)
    dot_number: str | None = Field(default=None, max_length=20)
    mc_number: str | None = Field(default=None, max_length=20)
    phone: Short = None
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=300)
    city: str | None = Field(default=None, max_length=80)
    state: Short = None
    postal_code: str | None = Field(default=None, max_length=20)
    timezone: TimeZone | None = None
    default_payment_terms_days: int | None = Field(default=None, ge=0, le=365)
    load_number_prefix: str | None = Field(default=None, min_length=1, max_length=10, pattern=r"^[A-Za-z0-9]+$")
    invoice_number_prefix: str | None = Field(default=None, min_length=1, max_length=10, pattern=r"^[A-Za-z0-9]+$")


# ---------------------------------------------------------------- team
class MemberCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    # Needed for a new sign-in. Ignored when the person already has one: they keep their own password.
    password: Password | None = None
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


class PermissionOut(BaseModel):
    key: str
    label: str


class PermissionGroupOut(BaseModel):
    name: str
    permissions: list[PermissionOut]


class RoleOut(BaseModel):
    key: str
    label: str
    description: str
    assignable: bool
    permissions: list[str]


class RoleMatrixOut(BaseModel):
    roles: list[RoleOut]
    groups: list[PermissionGroupOut]


# ---------------------------------------------------------------- terminals
class TerminalBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    code: str | None = Field(default=None, max_length=20)
    address: str | None = Field(default=None, max_length=300)
    city: str | None = Field(default=None, max_length=80)
    state: Short = None
    postal_code: str | None = Field(default=None, max_length=20)
    phone: Short = None


class TerminalCreate(TerminalBase):
    pass


class TerminalUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    code: str | None = Field(default=None, max_length=20)
    address: str | None = Field(default=None, max_length=300)
    city: str | None = Field(default=None, max_length=80)
    state: Short = None
    postal_code: str | None = Field(default=None, max_length=20)
    phone: Short = None


class TerminalRead(TerminalBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    status: str
    created_at: datetime


class TerminalListParams(ListParams):
    status: Literal["active", "archived"] | None = None


# ---------------------------------------------------------------- preferences, saved views, audit
class PreferenceIn(BaseModel):
    value: Any


class SavedViewCreate(BaseModel):
    resource: str = Field(min_length=1, max_length=40, pattern=r"^[a-z_]+$")
    name: str = Field(min_length=1, max_length=80)
    params: dict[str, Any]
    shared: bool = False


class SavedViewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    resource: str
    name: str
    params: dict[str, Any]
    shared: bool
    owner_user_id: uuid.UUID
    created_at: datetime


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    actor_user_id: uuid.UUID | None
    actor_name: str | None = None
    action: str
    entity_type: str
    entity_id: uuid.UUID | None
    data: dict | None
    request_id: str | None
    created_at: datetime


class AuditListParams(ListParams):
    actor_user_id: uuid.UUID | None = None
    action: str | None = Field(default=None, max_length=60)
    entity_type: str | None = Field(default=None, max_length=60)
    entity_id: uuid.UUID | None = None
    since: datetime | None = None
    until: datetime | None = None
