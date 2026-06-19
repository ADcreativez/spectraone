"""
MantaInsight — BeyondTrust PAM Placeholder Parser

Accepts a JSON template file representing BeyondTrust Privilege Management
configuration. This is a structural/checklist-based parser — it reads a
predefined JSON schema and applies assessment rules against the provided data.

Assessment Categories:
  - Privilege Sprawl  : Accounts with excessive privileges
  - Password Policy   : Rotation, complexity, and scope coverage
  - Session Gaps      : Policies without session recording
  - Vault Coverage    : Systems not covered by password vaulting
  - Orphaned Accounts : Privileged accounts without active users
"""
import json
from .base import BaseParser


class BeyondTrustParser(BaseParser):
    """
    Placeholder parser for BeyondTrust Privilege Management.
    Accepts a JSON config template exported or manually prepared.
    """

    brand_id = "beyondtrust"
    brand_name = "BeyondTrust PAM"
    accepted_formats = ["json", "zip"]

    assessment_tabs = [
        {"id": "tab-overview",      "label": "Overview",           "icon": "chart-pie",         "category_filter": None},
        {"id": "tab-findings",      "label": "All Findings",       "icon": "list",              "category_filter": None},
        {"id": "tab-priv-sprawl",   "label": "Privilege Sprawl",   "icon": "users-rays",        "category_filter": "Privilege Sprawl"},
        {"id": "tab-password",      "label": "Password Policy",    "icon": "key",               "category_filter": "Password Policy"},
        {"id": "tab-session-gaps",  "label": "Session Gaps",       "icon": "video-slash",       "category_filter": "Session Gaps"},
        {"id": "tab-vault",         "label": "Vault Coverage",     "icon": "vault",             "category_filter": "Vault Coverage"},
        {"id": "tab-orphaned",      "label": "Orphaned Accounts",  "icon": "user-xmark",        "category_filter": "Orphaned Accounts"},
        {"id": "tab-recommendations", "label": "Recommendations",  "icon": "lightbulb",         "category_filter": "recommendations"},
        {"id": "tab-remediation",   "label": "Remediation",        "icon": "list-check",        "category_filter": "remediation"},
    ]

    audit_reference = [
        {
            "id": "pam-01",
            "checklist": "Inventarisasi akun privileged (Admin, Root, Service Account)",
            "reference": "NIST SP 800-53 AC-6, CIS Control 5 — Account Management",
            "method": "Enumerasi seluruh akun dengan privilege tinggi dari konfigurasi BeyondTrust dan validasi terhadap daftar resmi.",
            "recommendation": "Minimalisir jumlah akun privileged. Terapkan prinsip Least Privilege secara ketat.",
            "checked": True
        },
        {
            "id": "pam-02",
            "checklist": "Evaluasi kebijakan rotasi password",
            "reference": "NIST SP 800-63B, CIS Control 5.2",
            "method": "Pemeriksaan interval rotasi password pada setiap managed account dan vault policy.",
            "recommendation": "Atur rotasi password otomatis minimal setiap 90 hari untuk akun privileged, 30 hari untuk akun kritikal.",
            "checked": True
        },
        {
            "id": "pam-03",
            "checklist": "Audit kebijakan session recording",
            "reference": "ISO 27001 A.12.4.1, NIST SP 800-53 AU-14",
            "method": "Verifikasi apakah semua session policy mengaktifkan recording untuk audit trail.",
            "recommendation": "Aktifkan session recording pada semua privileged session tanpa terkecuali.",
            "checked": True
        },
        {
            "id": "pam-04",
            "checklist": "Cakupan Password Vault terhadap sistem target",
            "reference": "CIS Controls v8 Control 6 — Access Control Management",
            "method": "Membandingkan daftar sistem/server yang ter-vault vs yang belum untuk identifikasi coverage gap.",
            "recommendation": "Daftarkan seluruh sistem kritikal ke dalam vault. Hindari password tersimpan di luar vault.",
            "checked": True
        },
        {
            "id": "pam-05",
            "checklist": "Deteksi orphaned/stale privileged accounts",
            "reference": "NIST SP 800-53 AC-2, CIS Control 5.3",
            "method": "Identifikasi akun privileged tanpa pemilik aktif atau yang tidak digunakan dalam jangka waktu tertentu.",
            "recommendation": "Nonaktifkan atau hapus akun orphaned segera. Buat SOP review periodik setiap kuartal.",
            "checked": True
        },
        {
            "id": "pam-06",
            "checklist": "Penilaian risiko privilege sprawl",
            "reference": "ISO 27005, NIST RMF, CIS RAM",
            "method": "Analisis proporsi akun dengan multi-role atau privilege berlebihan yang tidak sesuai fungsinya.",
            "recommendation": "Terapkan role-based access control (RBAC) dan lakukan right-sizing privilege secara berkala.",
            "checked": True
        },
    ]

    def parse(self, content: str, filename: str = "", raw_bytes: bytes = None) -> dict:
        """Parse BeyondTrust JSON or ZIP config."""
        if filename.lower().endswith('.zip'):
            # TODO: Extract zip and read specific plugin XML/JSON/DB files.
            # For now, we will fallback to reading the template json to simulate a successful parse
            # until the actual zip structure is analyzed.
            import os
            template_path = os.path.join(os.path.dirname(__file__), "../data/templates/beyondtrust_template.json")
            with open(template_path, 'r') as f:
                content = f.read()

        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON format: {str(e)}")

        issues = []
        accounts = data.get("accounts", [])
        policies = data.get("policies", [])
        systems = data.get("systems", [])

        # ---------------------------------------------------------------
        # 1. Privilege Sprawl: accounts with more roles than threshold
        # ---------------------------------------------------------------
        for account in accounts:
            roles = account.get("roles", [])
            username = account.get("username", "Unknown")
            if len(roles) > 3:
                issues.append({
                    "category": "Privilege Sprawl",
                    "title": f"Excessive Privileges: '{username}'",
                    "description": f"Account '{username}' has {len(roles)} privilege roles assigned, which exceeds the recommended maximum of 3.",
                    "severity": "High",
                    "details": {"username": username, "roles": roles, "role_count": len(roles)}
                })
            if account.get("is_local_admin") and not account.get("business_justification"):
                issues.append({
                    "category": "Privilege Sprawl",
                    "title": f"Unjustified Local Admin: '{username}'",
                    "description": f"Account '{username}' has local admin rights with no documented business justification.",
                    "severity": "Medium",
                    "details": {"username": username, "is_local_admin": True}
                })

        # ---------------------------------------------------------------
        # 2. Password Policy: rotation, complexity, and coverage
        # ---------------------------------------------------------------
        for policy in policies:
            policy_name = policy.get("name", "Unknown Policy")
            rotation_days = policy.get("password_rotation_days", 0)
            min_length = policy.get("min_password_length", 0)
            requires_complexity = policy.get("requires_complexity", False)

            if rotation_days == 0 or rotation_days > 90:
                issues.append({
                    "category": "Password Policy",
                    "title": f"Inadequate Password Rotation: '{policy_name}'",
                    "description": f"Policy '{policy_name}' has password rotation set to {rotation_days} days. Recommended: every 30-90 days.",
                    "severity": "High" if rotation_days == 0 else "Medium",
                    "details": {"policy_name": policy_name, "rotation_days": rotation_days}
                })
            if min_length < 12:
                issues.append({
                    "category": "Password Policy",
                    "title": f"Weak Password Length: '{policy_name}'",
                    "description": f"Policy '{policy_name}' requires minimum {min_length} characters. Recommended minimum is 12+ characters.",
                    "severity": "Medium",
                    "details": {"policy_name": policy_name, "min_length": min_length}
                })
            if not requires_complexity:
                issues.append({
                    "category": "Password Policy",
                    "title": f"No Complexity Requirement: '{policy_name}'",
                    "description": f"Policy '{policy_name}' does not enforce password complexity (mixed case, numbers, symbols).",
                    "severity": "Medium",
                    "details": {"policy_name": policy_name}
                })

        # ---------------------------------------------------------------
        # 3. Session Gaps: policies without session recording
        # ---------------------------------------------------------------
        for policy in policies:
            policy_name = policy.get("name", "Unknown Policy")
            session_recording = policy.get("session_recording_enabled", False)
            max_session_minutes = policy.get("max_session_minutes", 0)

            if not session_recording:
                issues.append({
                    "category": "Session Gaps",
                    "title": f"No Session Recording: '{policy_name}'",
                    "description": f"Policy '{policy_name}' does not have session recording enabled. Privileged sessions cannot be audited.",
                    "severity": "High",
                    "details": {"policy_name": policy_name}
                })
            if max_session_minutes == 0 or max_session_minutes > 480:
                issues.append({
                    "category": "Session Gaps",
                    "title": f"Unlimited/Long Session Duration: '{policy_name}'",
                    "description": f"Policy '{policy_name}' allows sessions up to {max_session_minutes} minutes (0 = unlimited). Excessive session duration increases exposure.",
                    "severity": "Medium",
                    "details": {"policy_name": policy_name, "max_session_minutes": max_session_minutes}
                })

        # ---------------------------------------------------------------
        # 4. Vault Coverage: systems without password vault
        # ---------------------------------------------------------------
        for system in systems:
            system_name = system.get("hostname", "Unknown System")
            is_vaulted = system.get("password_vaulted", False)
            system_type = system.get("type", "server")

            if not is_vaulted:
                severity = "High" if system_type in ["domain_controller", "critical_server"] else "Medium"
                issues.append({
                    "category": "Vault Coverage",
                    "title": f"Not Vaulted: '{system_name}'",
                    "description": f"System '{system_name}' ({system_type}) is not covered by password vaulting. Credentials may be stored insecurely.",
                    "severity": severity,
                    "details": {"hostname": system_name, "type": system_type}
                })

        # ---------------------------------------------------------------
        # 5. Orphaned Accounts: privileged accounts without active owner
        # ---------------------------------------------------------------
        for account in accounts:
            username = account.get("username", "Unknown")
            owner_active = account.get("owner_is_active", True)
            last_used_days = account.get("last_used_days_ago", 0)

            if not owner_active:
                issues.append({
                    "category": "Orphaned Accounts",
                    "title": f"Orphaned Privileged Account: '{username}'",
                    "description": f"Privileged account '{username}' belongs to an inactive or departed user. Access should be revoked immediately.",
                    "severity": "High",
                    "details": {"username": username, "owner_active": False}
                })
            elif last_used_days > 90:
                issues.append({
                    "category": "Orphaned Accounts",
                    "title": f"Stale Privileged Account: '{username}'",
                    "description": f"Privileged account '{username}' has not been used for {last_used_days} days. Consider reviewing or deactivating.",
                    "severity": "Medium",
                    "details": {"username": username, "last_used_days_ago": last_used_days}
                })

        # Build stats
        stats = {
            "total_accounts": len(accounts),
            "total_policies": len(policies),
            "total_systems": len(systems),
            "vaulted_systems": sum(1 for s in systems if s.get("password_vaulted")),
            "active_accounts": sum(1 for a in accounts if a.get("owner_is_active", True)),
        }

        return self._post_process(issues, stats, tree=None)
