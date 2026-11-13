"""Money is decimal, never float, and always leaves the API with exactly two decimal places."""
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from pydantic import AfterValidator

CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def money(value) -> Decimal:
    """Round to cents, half up, the way an invoice is added up by hand."""
    return Decimal(value).quantize(CENT, ROUND_HALF_UP)


# For response models: whatever arithmetic produced the value, it is sent as "1234.50", never "1234.5" or "0".
Money = Annotated[Decimal, AfterValidator(money)]
