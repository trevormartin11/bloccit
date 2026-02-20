"""
Core data models for contract QA tracking.

These models represent the key entities in the WPS QA framework:
- Contracts and their Performance Work Statements (PWS)
- Quality Assurance Surveillance Plans (QASP) mapped to PWS requirements
- Defect records with classification against contract-defined standards
- AQL thresholds and rolling defect rate tracking
"""

from datetime import datetime
from enum import Enum
from dataclasses import dataclass, field
from typing import Optional
from uuid import uuid4


class DefectSeverity(str, Enum):
    CRITICAL = "critical"
    MAJOR = "major"
    MINOR = "minor"
    OBSERVATION = "observation"


class ContractStatus(str, Enum):
    ACTIVE = "active"
    PENDING = "pending"
    CLOSED = "closed"
    AT_RISK = "at_risk"


@dataclass
class Contract:
    name: str
    contract_number: str
    prime_contractor: str
    status: ContractStatus = ContractStatus.PENDING
    aql_threshold: float = 0.0
    id: str = field(default_factory=lambda: str(uuid4()))
    created_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class PWSRequirement:
    contract_id: str
    section: str
    description: str
    performance_standard: str
    id: str = field(default_factory=lambda: str(uuid4()))


@dataclass
class QASPMapping:
    pws_requirement_id: str
    surveillance_method: str
    sampling_procedure: str
    acceptable_quality_level: float
    id: str = field(default_factory=lambda: str(uuid4()))


@dataclass
class Defect:
    contract_id: str
    qasp_mapping_id: str
    severity: DefectSeverity
    description: str
    work_product_reference: str
    corrective_action: Optional[str] = None
    resolved: bool = False
    id: str = field(default_factory=lambda: str(uuid4()))
    recorded_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class DefectRateSnapshot:
    contract_id: str
    period_start: datetime
    period_end: datetime
    total_sampled: int
    total_defects: int
    defect_rate: float
    aql_threshold: float
    within_aql: bool = True
    id: str = field(default_factory=lambda: str(uuid4()))
    created_at: datetime = field(default_factory=datetime.utcnow)
