"""
MantaInsight — Symantec DLP Placeholder Parser

Accepts a JSON template file representing Symantec Data Loss Prevention
policy configuration. Applies DLP-specific assessment rules to identify
coverage gaps, rule conflicts, and policy hygiene issues.

Assessment Categories:
  - Policy Coverage      : Sensitive data types without DLP coverage
  - Rule Conflicts       : Overlapping or mutually-canceling rules
  - Response Rules       : Rules without effective response actions
  - Endpoint vs Network  : Coverage gaps between endpoint and network policies
  - Severity Calibration : Rules with inappropriate severity settings
"""
import json
from .base import BaseParser


class SymantecDLPParser(BaseParser):
    """
    Placeholder parser for Symantec Data Loss Prevention.
    Accepts a JSON config template representing DLP policies and rules.
    """

    brand_id = "symantec_dlp"
    brand_name = "Symantec DLP"
    accepted_formats = ["json"]

    assessment_tabs = [
        {"id": "tab-overview",       "label": "Overview",           "icon": "chart-pie",      "category_filter": None},
        {"id": "tab-findings",       "label": "All Findings",       "icon": "list",           "category_filter": None},
        {"id": "tab-coverage",       "label": "Policy Coverage",    "icon": "shield-halved",  "category_filter": "Policy Coverage"},
        {"id": "tab-conflicts",      "label": "Rule Conflicts",     "icon": "code-branch",    "category_filter": "Rule Conflicts"},
        {"id": "tab-response",       "label": "Response Rules",     "icon": "bell-slash",     "category_filter": "Response Rules"},
        {"id": "tab-ep-vs-net",      "label": "Endpoint vs Network","icon": "network-wired",  "category_filter": "Endpoint vs Network"},
        {"id": "tab-severity",       "label": "Severity Calibration","icon": "gauge-high",    "category_filter": "Severity Calibration"},
        {"id": "tab-recommendations", "label": "Recommendations",   "icon": "lightbulb",      "category_filter": "recommendations"},
        {"id": "tab-remediation",    "label": "Remediation",        "icon": "list-check",     "category_filter": "remediation"},
    ]

    audit_reference = [
        {
            "id": "dlp-01",
            "checklist": "Validasi cakupan tipe data sensitif",
            "reference": "NIST SP 800-122, GDPR Art. 32, PCI DSS Req 3",
            "method": "Membandingkan data type identifier yang dikonfigurasi pada setiap policy terhadap standar tipe data sensitif (PII, PHI, PCI, dll).",
            "recommendation": "Pastikan semua kategori data sensitif yang relevan memiliki minimal satu policy DLP aktif.",
            "checked": True
        },
        {
            "id": "dlp-02",
            "checklist": "Deteksi konflik antar rule DLP",
            "reference": "Symantec DLP Admin Guide, NIST SP 800-53 SC-7",
            "method": "Analisis rule dengan data type dan channel yang sama untuk menemukan konflik response action (block vs allow).",
            "recommendation": "Konsolidasikan rule yang berkonflik menjadi satu rule dengan prioritas aksi yang jelas.",
            "checked": True
        },
        {
            "id": "dlp-03",
            "checklist": "Audit response rule dan action policy",
            "reference": "ISO 27001 A.13.2.1, CIS Control 3",
            "method": "Pemeriksaan apakah setiap rule memiliki response action yang efektif (Block, Encrypt, Quarantine) vs hanya log-only.",
            "recommendation": "Aktifkan response action enforcement pada rule untuk data dengan klasifikasi tinggi.",
            "checked": True
        },
        {
            "id": "dlp-04",
            "checklist": "Evaluasi gap Endpoint vs Network DLP",
            "reference": "NIST SP 800-53 SC-7, CIS Control 13.6",
            "method": "Membandingkan cakupan policy antara Endpoint Agent dan Network Monitor/Prevent.",
            "recommendation": "Sinkronkan policy antara endpoint dan network channel untuk menghindari bypass.",
            "checked": True
        },
        {
            "id": "dlp-05",
            "checklist": "Kalibrasi severity level pada setiap rule",
            "reference": "NIST SP 800-61r2, ISO 27001 A.16.1.4",
            "method": "Review kesesuaian severity setting (High/Medium/Low) terhadap tingkat sensitivitas data yang dilindungi.",
            "recommendation": "Sesuaikan severity rule dengan klasifikasi data. Data PCI/PII harus minimal severity High.",
            "checked": True
        },
        {
            "id": "dlp-06",
            "checklist": "Penilaian risiko dan prioritas remediasi",
            "reference": "ISO 27005, NIST RMF, CIS RAM",
            "method": "Agregasi temuan dari semua kategori dan pemeringkatan berdasarkan dampak terhadap perlindungan data.",
            "recommendation": "Prioritaskan perbaikan pada coverage gap dan konflik rule sebelum fine-tuning severity.",
            "checked": True
        },
    ]

    # All standard sensitive data types that should be covered
    STANDARD_DATA_TYPES = [
        "Credit Card Numbers", "Social Security Numbers", "Passport Numbers",
        "Bank Account Numbers", "Medical Records (PHI)", "Intellectual Property",
        "Personal Identifiable Information (PII)", "Source Code",
        "Confidential Documents", "Employee Records"
    ]

    def parse(self, content: str, filename: str = "", raw_bytes: bytes = None) -> dict:
        """Parse Symantec DLP JSON config template."""
        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON format: {str(e)}")

        issues = []
        policies = data.get("policies", [])
        rules = data.get("rules", [])
        response_rules = data.get("response_rules", [])

        # ---------------------------------------------------------------
        # 1. Policy Coverage: Check for uncovered sensitive data types
        # ---------------------------------------------------------------
        covered_data_types = set()
        for policy in policies:
            covered_data_types.update(policy.get("data_types", []))

        for data_type in self.STANDARD_DATA_TYPES:
            if data_type not in covered_data_types:
                issues.append({
                    "category": "Policy Coverage",
                    "title": f"Uncovered Data Type: '{data_type}'",
                    "description": f"No DLP policy covers '{data_type}'. This sensitive data type has no protection rules configured.",
                    "severity": "High",
                    "details": {"data_type": data_type, "covered_types": list(covered_data_types)}
                })

        # Check for policies with no data types defined
        for policy in policies:
            policy_name = policy.get("name", "Unknown Policy")
            if not policy.get("data_types"):
                issues.append({
                    "category": "Policy Coverage",
                    "title": f"Policy Without Data Types: '{policy_name}'",
                    "description": f"Policy '{policy_name}' has no data type identifiers configured. The policy cannot detect any content.",
                    "severity": "High",
                    "details": {"policy_name": policy_name}
                })

        # ---------------------------------------------------------------
        # 2. Rule Conflicts: Overlapping rules or conflicting severities
        # ---------------------------------------------------------------
        seen_patterns = {}
        for rule in rules:
            rule_name = rule.get("name", "Unknown Rule")
            patterns = tuple(sorted(rule.get("match_patterns", [])))
            severity = rule.get("severity", "Low")

            if patterns and patterns in seen_patterns:
                prev_rule, prev_severity = seen_patterns[patterns]
                issues.append({
                    "category": "Rule Conflicts",
                    "title": f"Conflicting Rules: '{rule_name}' & '{prev_rule}'",
                    "description": f"Rules '{rule_name}' (severity: {severity}) and '{prev_rule}' (severity: {prev_severity}) match the same patterns. Only one will be applied.",
                    "severity": "Medium",
                    "details": {
                        "rule_a": rule_name, "rule_b": prev_rule,
                        "conflicting_patterns": list(patterns)
                    }
                })
            elif patterns:
                seen_patterns[patterns] = (rule_name, severity)

        # ---------------------------------------------------------------
        # 3. Response Rules: Rules without effective response actions
        # ---------------------------------------------------------------
        for rule in rules:
            rule_name = rule.get("name", "Unknown Rule")
            linked_responses = rule.get("response_rule_ids", [])
            is_enabled = rule.get("enabled", True)

            if is_enabled and not linked_responses:
                issues.append({
                    "category": "Response Rules",
                    "title": f"No Response Action: '{rule_name}'",
                    "description": f"Rule '{rule_name}' is enabled but has no response rules linked. Detected violations will be logged but no blocking or alerting action will occur.",
                    "severity": "High",
                    "details": {"rule_name": rule_name}
                })

        # Check for response rules that only log (no block/notify)
        for resp in response_rules:
            resp_name = resp.get("name", "Unknown Response")
            actions = resp.get("actions", [])
            has_active_action = any(a.get("type") in ["block", "quarantine", "notify_user", "notify_admin"] for a in actions)
            if not has_active_action:
                issues.append({
                    "category": "Response Rules",
                    "title": f"Passive-Only Response: '{resp_name}'",
                    "description": f"Response rule '{resp_name}' only logs violations without blocking, quarantining, or notifying anyone.",
                    "severity": "Medium",
                    "details": {"response_name": resp_name, "actions": actions}
                })

        # ---------------------------------------------------------------
        # 4. Endpoint vs Network Coverage Gaps
        # ---------------------------------------------------------------
        endpoint_policies = {p["name"] for p in policies if "endpoint" in p.get("channels", [])}
        network_policies = {p["name"] for p in policies if "network" in p.get("channels", [])}

        for policy in policies:
            policy_name = policy.get("name", "Unknown Policy")
            channels = policy.get("channels", [])
            if "endpoint" in channels and "network" not in channels:
                issues.append({
                    "category": "Endpoint vs Network",
                    "title": f"Endpoint-Only Policy: '{policy_name}'",
                    "description": f"Policy '{policy_name}' only monitors endpoint channels. The same data type is not protected on network channels (email, web, FTP).",
                    "severity": "Medium",
                    "details": {"policy_name": policy_name, "channels": channels}
                })
            elif "network" in channels and "endpoint" not in channels:
                issues.append({
                    "category": "Endpoint vs Network",
                    "title": f"Network-Only Policy: '{policy_name}'",
                    "description": f"Policy '{policy_name}' only monitors network channels. Endpoint (USB, print, clipboard) transfers are not covered.",
                    "severity": "Medium",
                    "details": {"policy_name": policy_name, "channels": channels}
                })

        # ---------------------------------------------------------------
        # 5. Severity Calibration: Rules with inappropriate severities
        # ---------------------------------------------------------------
        HIGH_RISK_TYPES = ["Credit Card Numbers", "Social Security Numbers", "Medical Records (PHI)", "Passport Numbers"]
        for policy in policies:
            policy_name = policy.get("name", "Unknown Policy")
            policy_severity = policy.get("severity", "Low")
            policy_data_types = policy.get("data_types", [])

            has_high_risk = any(dt in HIGH_RISK_TYPES for dt in policy_data_types)
            if has_high_risk and policy_severity == "Low":
                issues.append({
                    "category": "Severity Calibration",
                    "title": f"Underseverity for High-Risk Data: '{policy_name}'",
                    "description": f"Policy '{policy_name}' covers high-risk data types ({', '.join([dt for dt in policy_data_types if dt in HIGH_RISK_TYPES])}) but is configured with LOW severity.",
                    "severity": "High",
                    "details": {"policy_name": policy_name, "current_severity": policy_severity, "high_risk_types": [dt for dt in policy_data_types if dt in HIGH_RISK_TYPES]}
                })

        # Build stats
        stats = {
            "total_policies": len(policies),
            "total_rules": len(rules),
            "total_response_rules": len(response_rules),
            "covered_data_types": len(covered_data_types),
            "uncovered_data_types": len(self.STANDARD_DATA_TYPES) - len(covered_data_types & set(self.STANDARD_DATA_TYPES)),
            "enabled_rules": sum(1 for r in rules if r.get("enabled", True)),
        }

        return self._post_process(issues, stats, tree=None)
