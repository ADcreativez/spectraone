"""
MantaInsight — BaseParser Abstract Class
All brand-specific parsers must extend this class and implement the `parse()` method.
"""
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any


class BaseParser(ABC):
    """
    Abstract base class for all MantaInsight brand assessment parsers.

    Each parser subclass defines:
    - brand_id: unique identifier matching the BRANDS config in server.py
    - brand_name: human-readable brand name
    - accepted_formats: list of file extensions this parser can handle
    - assessment_tabs: list of tab definitions for the frontend UI

    The parse() method must return a standardized dict structure.
    """

    brand_id: str = ""
    brand_name: str = ""
    accepted_formats: list = []  # e.g. ['xml'], ['json'], ['xml', 'json']

    # Default assessment tabs — subclasses should override this
    assessment_tabs: list = [
        {"id": "tab-overview", "label": "Overview", "icon": "chart-pie", "category_filter": None},
        {"id": "tab-findings", "label": "All Findings", "icon": "list", "category_filter": None},
        {"id": "tab-remediation", "label": "Remediation", "icon": "list-check", "category_filter": "remediation"},
    ]

    # Default audit reference — subclasses should override this
    audit_reference: list = []

    @abstractmethod
    def parse(self, content: str, filename: str, raw_bytes: bytes = None) -> dict:
        """
        Parse the configuration file content and return a standardized result dict.

        Args:
            content: Raw file content as string
            filename: Original filename (for format hints)

        Returns:
            {
                "session_id": str,          # Set by server after parsing
                "brand_id": str,
                "brand_name": str,
                "stats": {
                    "total_issues": int,
                    "high_issues": int,
                    "medium_issues": int,
                    "low_issues": int,
                    "info_issues": int,
                    ... brand-specific stats
                },
                "issues": [
                    {
                        "id": str,              # Set by post-processor (issue_1, issue_2, ...)
                        "category": str,        # Maps to a specific tab
                        "severity": str,        # "High" | "Medium" | "Low" | "Info"
                        "title": str,
                        "description": str,
                        "details": dict,        # Brand-specific detail object
                        "resolved": bool,       # Default: False
                    }
                ],
                "tree": dict | None,            # Optional config hierarchy for Explorer tab
                "assessment_tabs": list,        # Tab definitions for frontend
                "audit_reference": list,        # Audit checklist items
            }
        """
        pass

    def _post_process(self, issues: list, stats: dict, tree: Any = None) -> dict:
        """
        Standard post-processing: assign sequential IDs, set resolved=False,
        compute issue counts, and return the final result dict.
        """
        # Assign sequential IDs and default resolved state
        for idx, issue in enumerate(issues):
            issue["id"] = f"issue_{idx + 1}"
            issue.setdefault("resolved", False)

        # Compute severity counts
        stats["total_issues"] = len(issues)
        stats["critical_issues"] = sum(1 for i in issues if i["severity"] == "Critical")
        stats["high_issues"] = sum(1 for i in issues if i["severity"] == "High")
        stats["medium_issues"] = sum(1 for i in issues if i["severity"] == "Medium")
        stats["low_issues"] = sum(1 for i in issues if i["severity"] == "Low")
        stats["info_issues"] = sum(1 for i in issues if i["severity"] == "Info")

        return {
            "brand_id": self.brand_id,
            "brand_name": self.brand_name,
            "stats": stats,
            "issues": issues,
            "tree": tree,
            "assessment_tabs": self.assessment_tabs,
            "audit_reference": self.audit_reference,
        }

    def validate_format(self, filename: str) -> bool:
        """Check if the uploaded file extension is accepted by this parser."""
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        return ext in self.accepted_formats
