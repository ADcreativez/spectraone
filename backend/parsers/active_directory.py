import json
import zipfile
import io
import xml.etree.ElementTree as ET
from backend.parsers.base import BaseParser

class ActiveDirectoryParser(BaseParser):
    brand_id = "active_directory"
    brand_name = "Active Directory"
    accepted_formats = ["json", "xml", "zip"]

    assessment_tabs = [
        {"id": "tab-overview", "title": "AD Overview", "icon": "fa-solid fa-chart-pie", "category_filter": None},
        {"id": "tab-findings", "title": "All Findings", "icon": "fa-solid fa-list", "category_filter": None},
        {"id": "tab-stale-accounts", "title": "Stale Accounts", "icon": "fa-solid fa-user-clock", "category_filter": "Stale Accounts"},
        {"id": "tab-privileges", "title": "Privilege Risks", "icon": "fa-solid fa-user-shield", "category_filter": "Privileges"},
        {"id": "tab-ad-graph", "title": "Attack Paths Graph", "icon": "fa-solid fa-project-diagram", "category_filter": None},
        {"id": "tab-recommendations", "title": "Recommendations", "icon": "fa-solid fa-lightbulb", "category_filter": "recommendations"},
        {"id": "tab-remediation", "title": "Remediation", "icon": "fa-solid fa-list-check", "category_filter": "remediation"}
    ]

    audit_reference = [
        {
            "id": "ad-01",
            "checklist": "Inventarisasi akun stale/inactive di Active Directory",
            "reference": "NIST SP 800-53 AC-2, CIS Control 5.3",
            "method": "Identifikasi akun yang tidak login dalam 90+ hari menggunakan atribut lastLogonTimestamp.",
            "recommendation": "Nonaktifkan akun yang inactive >90 hari dan hapus setelah 180 hari tanpa aktivitas.",
            "checked": True
        },
        {
            "id": "ad-02",
            "checklist": "Audit keanggotaan grup privileged (Domain Admins, Enterprise Admins)",
            "reference": "CIS Benchmark for Windows Server, NIST SP 800-53 AC-6",
            "method": "Enumerasi anggota grup high-privilege dan validasi terhadap daftar resmi yang disetujui. Deteksi sesi admin aktif di workstation.",
            "recommendation": "Minimalisir keanggotaan Domain Admins. Gunakan akun terpisah untuk administrasi. Hindari login Domain Admin di workstation non-DC.",
            "checked": True
        },
        {
            "id": "ad-03",
            "checklist": "Evaluasi kebijakan password dan account lockout",
            "reference": "NIST SP 800-63B, CIS Control 5.2",
            "method": "Review Group Policy Objects (GPO) terkait password complexity, length, dan lockout threshold, serta audit perizinan modifikasi GPO.",
            "recommendation": "Minimal 12 karakter, complexity enabled, lockout setelah 5 kali percobaan gagal. Amankan GPO agar tidak bisa dimodifikasi user biasa.",
            "checked": True
        },
        {
            "id": "ad-04",
            "checklist": "Deteksi akun service dengan password tidak pernah expire",
            "reference": "ISO 27001 A.9.4.3, CIS Control 5.2",
            "method": "Identifikasi akun dengan flag 'password never expires' yang aktif.",
            "recommendation": "Gunakan Group Managed Service Accounts (gMSA) untuk rotasi password otomatis.",
            "checked": True
        },
        {
            "id": "ad-05",
            "checklist": "Penilaian risiko dan prioritas remediasi AD",
            "reference": "ISO 27005, NIST RMF, CIS RAM",
            "method": "Agregasi temuan dari stale accounts, privilege risks, ADCS vulnerabilities, dan policy gaps.",
            "recommendation": "Prioritaskan remediasi privilege risk, ADCS certificate templates, dan akun stale dengan akses tinggi.",
            "checked": True
        },
        {
            "id": "ad-06",
            "checklist": "Deteksi Kerberos Delegation yang tidak aman (Unconstrained Delegation)",
            "reference": "NIST SP 800-53 AC-6, Mitre ATT&CK T1018",
            "method": "Memeriksa flag ADS_UF_TRUSTED_FOR_DELEGATION pada properti user/computer serta Constrained Delegation.",
            "recommendation": "Ubah delegasi menjadi Constrained Delegation atau Resource-Based Constrained Delegation (RBCD). Batasi target delegasi.",
            "checked": True
        },
        {
            "id": "ad-07",
            "checklist": "Audit konfigurasi Local Administrator Password Solution (LAPS)",
            "reference": "CIS Control 4.1 — Establish and Maintain a Security Configuration",
            "method": "Verifikasi ms-Mcs-AdmPwd untuk memastikan LAPS diaktifkan dan audit jumlah Local Admins per komputer.",
            "recommendation": "Terapkan Windows LAPS untuk merotasi password Administrator lokal secara otomatis di setiap workstation. Batasi Local Admins.",
            "checked": True
        },
        {
            "id": "ad-08",
            "checklist": "Deteksi Akun dengan Pre-Authentication Dinonaktifkan (AS-REP Roasting)",
            "reference": "Mitre ATT&CK T1558.004, CIS Control 5.2",
            "method": "Mengidentifikasi akun user dengan flag DONT_REQ_PREAUTH aktif.",
            "recommendation": "Aktifkan kembali Kerberos Pre-Authentication pada akun tersebut dan ganti password dengan tingkat kompleksitas tinggi.",
            "checked": True
        },
        {
            "id": "ad-09",
            "checklist": "Verifikasi objek AdminSDHolder dan hak waris (Inheritance ACL)",
            "reference": "Active Directory Security Best Practices",
            "method": "Memeriksa objek-objek penting yang tidak mewarisi permission induk (broken inheritance) dan audit dangerous ACEs (GenericAll, GenericWrite).",
            "recommendation": "Aktifkan kembali inheritance pada objek non-admin. Bersihkan ACL backdoor (GenericAll/WriteDacl) pada objek krusial.",
            "checked": True
        },
        {
            "id": "ad-10",
            "checklist": "Audit keanggotaan grup sensitif Account Operators & Backup Operators",
            "reference": "NIST SP 800-53 AC-2, CIS Windows Server Benchmark",
            "method": "Enumerasi keanggotaan grup operasional default yang memiliki privilese tinggi namun jarang dipantau.",
            "recommendation": "Kosongkan atau batasi ketat anggota Account Operators, Backup Operators, dan Server Operators.",
            "checked": True
        },
        {
            "id": "ad-11",
            "checklist": "Review Kerberoastable Accounts (SPN pada Akun User biasa)",
            "reference": "Mitre ATT&CK T1558.003, CIS Control 5.2",
            "method": "Mendeteksi akun user biasa (non-computer) yang memiliki Service Principal Name (SPN) terdaftar.",
            "recommendation": "Batasi akun ber-SPN, gunakan password yang sangat panjang (>25 karakter) atau gunakan gMSA.",
            "checked": True
        },
        {
            "id": "ad-12",
            "checklist": "Verifikasi SMB Signing Policy pada Domain Controllers",
            "reference": "CIS Microsoft Windows Server Benchmark, SC-8",
            "method": "Memeriksa GPO terkait pengaktifan 'Digitally sign communications (always)' untuk mencegah relay attack.",
            "recommendation": "Pastikan SMB Signing diwajibkan (Require) pada seluruh Domain Controller dan server kritis.",
            "checked": True
        },
        {
            "id": "ad-13",
            "checklist": "Deteksi Keberadaan Skrip SYSVOL GPP berisi Password Plaintext",
            "reference": "Mitre ATT&CK T1552.001, CIS Control 5.2",
            "method": "Scanning file Groups.xml di folder SYSVOL untuk mendeteksi atribut cpassword.",
            "recommendation": "Hapus preferensi password dari GPO lama dan install patch KB2962486 yang melarang GPP password.",
            "checked": True
        },
        {
            "id": "ad-14",
            "checklist": "Evaluasi Konfigurasi LDAP Signing dan Channel Binding",
            "reference": "CVE-2017-8563, NIST SP 800-53 SC-8",
            "method": "Memeriksa kebijakan GPO 'LDAP Server Signing Requirements' dan LDAP Channel Binding.",
            "recommendation": "Aktifkan LDAP signing 'Require signing' dan LDAP Channel Binding untuk menangkal serangan Man-in-the-Middle.",
            "checked": True
        },
        {
            "id": "ad-15",
            "checklist": "Audit Akun Krusial KRBTGT",
            "reference": "AD Security Golden Ticket Mitigation Guide",
            "method": "Verifikasi tanggal terakhir pergantian password akun KRBTGT untuk mencegah eksploitasi tiket Kerberos lama.",
            "recommendation": "Lakukan reset password KRBTGT sebanyak 2 kali secara berkala (minimal 1 atau 2 tahun sekali) menggunakan script reset KRBTGT resmi.",
            "checked": True
        }
    ]

    def parse(self, content: str, filename: str, raw_bytes: bytes = None) -> dict:
        issues = []
        stats = {
            "total_users": 0,
            "total_computers": 0,
            "total_groups": 0,
            "domain_admins": 0
        }
        tree = {
            "id": "ad_root",
            "name": "Active Directory",
            "type": "folder",
            "children": []
        }

        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

        if ext == "zip" and raw_bytes:
            return self._parse_bloodhound_zip(raw_bytes, issues, stats, tree)
        elif ext == "json":
            try:
                data = json.loads(content)
                self._parse_bloodhound_json(data, issues, stats, tree)
            except json.JSONDecodeError:
                raise ValueError("Invalid JSON format uploaded.")
        elif ext == "xml":
            self._parse_pingcastle_xml(content, issues, stats, tree)
        else:
            raise ValueError(f"Unsupported AD data format: {ext}")

        return self._post_process(issues, stats, tree)

    def _parse_bloodhound_zip(self, raw_bytes, issues, stats, tree):
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as z:
                # First collect all data from JSON files
                combined_data = {
                    "users": [],
                    "computers": [],
                    "groups": [],
                    "gpos": [],
                    "certificatetemplates": [],
                    "domains": []
                }
                for file_info in z.infolist():
                    if file_info.filename.endswith(".json"):
                        with z.open(file_info) as f:
                            try:
                                data = json.load(f)
                                meta_type = data.get("meta", {}).get("type", "").lower()
                                elements = data.get("data", []) or data.get("users", []) or data.get("computers", []) or data.get("groups", []) or data.get("gpos", []) or []
                                
                                if "users" in data or meta_type == "users":
                                    combined_data["users"].extend(elements if isinstance(elements, list) else [])
                                elif "computers" in data or meta_type == "computers":
                                    combined_data["computers"].extend(elements if isinstance(elements, list) else [])
                                elif "groups" in data or meta_type == "groups":
                                    combined_data["groups"].extend(elements if isinstance(elements, list) else [])
                                elif "gpos" in data or meta_type == "gpos" or meta_type == "gpo":
                                    combined_data["gpos"].extend(elements if isinstance(elements, list) else [])
                                elif "certificatetemplates" in data or meta_type == "certificatetemplates" or meta_type == "certtemplate":
                                    combined_data["certificatetemplates"].extend(elements if isinstance(elements, list) else [])
                                elif "domains" in data or meta_type == "domains":
                                    combined_data["domains"].extend(elements if isinstance(elements, list) else [])
                                else:
                                    # Fallback inspection of keys
                                    for key in ["users", "computers", "groups", "gpos", "domains"]:
                                        if key in data:
                                            combined_data[key].extend(data[key])
                            except Exception:
                                pass
                self._parse_bloodhound_json(combined_data, issues, stats, tree)
        except zipfile.BadZipFile:
            raise ValueError("Invalid ZIP file uploaded. Must be a BloodHound export zip.")
        return self._post_process(issues, stats, tree)

    def _parse_bloodhound_json(self, data, issues, stats, tree):
        # Normalize keys in data dict
        users = data.get("users", [])
        computers = data.get("computers", [])
        groups = data.get("groups", [])
        gpos = data.get("gpos", [])
        domains = data.get("domains", [])
        cert_templates = data.get("certificatetemplates", [])

        # Fallback if the data is a single BloodHound JSON containing a 'data' array
        if not users and not computers and "data" in data:
            elements = data["data"]
            meta_type = data.get("meta", {}).get("type", "").lower()
            if meta_type == "users":
                users = elements
            elif meta_type == "computers":
                computers = elements
            elif meta_type == "groups":
                groups = elements
            elif meta_type == "gpos" or meta_type == "gpo":
                gpos = elements

        stats["total_users"] = len(users)
        stats["total_computers"] = len(computers)
        stats["total_groups"] = len(groups)

        users_node = {"id": "users", "name": "Users", "type": "folder", "children": []}
        comp_node = {"id": "computers", "name": "Computers", "type": "folder", "children": []}
        groups_node = {"id": "groups", "name": "Groups", "type": "folder", "children": []}
        tree["children"] = [users_node, comp_node, groups_node]

        # Domain Admins names tracking
        domain_admins_sids = set()
        domain_admins_names = set()

        # Phase 1: Pre-scan Groups to identify Domain Admins and other high privilege groups
        for grp in groups:
            props = grp.get("Properties", {})
            gname = props.get("name", "").upper()
            gid = grp.get("ObjectIdentifier", "")
            
            # Populate groups tree node
            if len(groups_node["children"]) < 200:
                groups_node["children"].append({
                    "id": gid,
                    "name": props.get("name", "Unknown Group"),
                    "type": "inner_rule",
                    "enabled": True
                })

            if "DOMAIN ADMINS" in gname or gid.endswith("-512"):
                domain_admins_sids.add(gid)
                # Parse members
                members = grp.get("Members", [])
                for member in members:
                    domain_admins_sids.add(member.get("ObjectIdentifier", ""))
                    domain_admins_names.add(member.get("Name", "").upper())

        # Phase 2: User Audits
        for user in users:
            props = user.get("Properties", {})
            name = props.get("name", "Unknown User")
            uid = user.get("ObjectIdentifier", "")
            is_admin = props.get("admincount", False) or uid in domain_admins_sids or name.upper() in domain_admins_names
            enabled = props.get("enabled", True)

            if len(users_node["children"]) < 50:
                users_node["children"].append({
                    "id": uid,
                    "name": name,
                    "type": "rule",
                    "enabled": enabled
                })

            if is_admin:
                stats["domain_admins"] += 1
                issues.append({
                    "category": "Privileges",
                    "severity": "Critical",
                    "title": "High Privilege Account Detected",
                    "description": f"User {name} has AdminCount=1 or Domain Admin group membership.",
                    "impact": "Domain Admin compromise allows total takeover of the Active Directory domain.",
                    "use_case": "Attackers target Domain Admins using Kerberoasting or AS-REP Roasting.",
                    "details": {"user": name, "admincount": True}
                })

            if not enabled:
                issues.append({
                    "category": "Stale Accounts",
                    "severity": "Low",
                    "title": "Disabled User Account",
                    "description": f"User {name} is disabled but still exists. Consider archiving and deleting.",
                    "impact": "Disabled accounts increase the active directory footprint and attack surface.",
                    "use_case": "Disabled accounts can be re-enabled if OU delegation is misconfigured.",
                    "details": {"user": name, "enabled": False}
                })

            if props.get("stale") or props.get("lastlogontimestamp", 0) == -1:
                issues.append({
                    "category": "Stale Accounts",
                    "severity": "Low",
                    "title": "Stale/Inactive Account",
                    "description": f"User {name} has not logged in for over 90 days.",
                    "impact": "Stale accounts are major targets for password spraying and stealth logins.",
                    "use_case": "Penetration testers search for inactive accounts to compromise with low detection risk.",
                    "details": {"user": name, "stale": True}
                })

            if props.get("passwordneverexpires") or props.get("password_never_expires"):
                is_service = any(x in name.lower() for x in ["svc-", "service", "backup", "sql"])
                issues.append({
                    "category": "Privileges" if is_service else "Stale Accounts",
                    "severity": "Medium",
                    "title": "Password Never Expires flag set",
                    "description": f"User account {name} is configured with password never expires.",
                    "impact": "A static password never expires, increasing the threat of credential leaks over time.",
                    "use_case": "If an attacker cracks the password hash offline, the credential remains valid indefinitely.",
                    "details": {"user": name, "password_never_expires": True}
                })

            # Kerberos delegation
            if props.get("unconstraineddelegation") or props.get("trustedfordelegation"):
                issues.append({
                    "category": "Privileges",
                    "severity": "Critical",
                    "title": "Unconstrained Kerberos Delegation",
                    "description": f"Account {name} is configured with Unconstrained Kerberos Delegation.",
                    "impact": "Allows the host to impersonate any user who authenticates, harvesting their TGT.",
                    "use_case": "An attacker coerces Domain Admins to authenticate to this host and dumps their TGT.",
                    "details": {"user": name, "delegation": "unconstrained"}
                })

            # Constrained Delegation
            allowed_to_delegate = props.get("allowedtodelegate", []) or props.get("msds-allowedtodelegateto", [])
            if allowed_to_delegate:
                issues.append({
                    "category": "Privileges",
                    "severity": "Medium",
                    "title": "Constrained Kerberos Delegation Risk",
                    "description": f"Account {name} has Constrained Delegation configured targeting: {', '.join(allowed_to_delegate[:3])}",
                    "impact": "Constrained delegation allows impersonation of users to specific services, which can be abused if the account is compromised.",
                    "use_case": "Attackers request tickets on behalf of arbitrary users to compromise the targeted service.",
                    "details": {"user": name, "allowed_to_delegate": allowed_to_delegate}
                })

            if props.get("dontreqpreauth"):
                issues.append({
                    "category": "Privileges",
                    "severity": "Critical",
                    "title": "Kerberos Pre-Authentication Disabled",
                    "description": f"Account {name} does not require Kerberos Pre-Authentication.",
                    "impact": "Enables offline cracking (AS-REP Roasting) without any network authentication queries.",
                    "use_case": "Attackers query AS-REPs and run Hashcat to guess plaintext passwords.",
                    "details": {"user": name, "preauth": "disabled"}
                })

            if props.get("hasspn") or props.get("serviceprincipalnames"):
                issues.append({
                    "category": "Privileges",
                    "severity": "Medium",
                    "title": "Kerberoastable Account Detected",
                    "description": f"User account {name} has a registered Service Principal Name (SPN).",
                    "impact": "Any domain user can extract Kerberos tickets and crack the password offline.",
                    "use_case": "Attackers run Invoke-Kerberoast to pull TGS tickets and crack passwords.",
                    "details": {"user": name, "spn": props.get("serviceprincipalnames", "SPN")}
                })

            # Check ACLs on the user object
            for ace in user.get("Aces", []):
                right = ace.get("RightName", "")
                principal = ace.get("PrincipalName", "")
                if right in ["GenericAll", "GenericWrite", "WriteDacl", "WriteOwner", "ForceChangePassword"]:
                    # Flag dangerous permissions from non-admin account
                    if "DOMAIN ADMINS" not in principal.upper() and "ENTERPRISE ADMINS" not in principal.upper():
                        issues.append({
                            "category": "Privileges",
                            "severity": "Critical",
                            "title": "Dangerous ACL Permission Detected",
                            "description": f"User/Group '{principal}' has '{right}' rights over user object '{name}'.",
                            "impact": "Allows the principal to take full control, reset passwords, or modify permissions on this account.",
                            "use_case": "An attacker compromising the principal account instantly inherits control of this user.",
                            "details": {"target": name, "principal": principal, "right": right}
                        })
                        # Shortest Path to Domain Admin Simulation
                        if is_admin:
                            issues.append({
                                "category": "Privileges",
                                "severity": "Critical",
                                "title": "Shortest Path to Domain Admin Detected",
                                "description": f"Path: {principal} -> ({right}) -> {name} (Domain Admin)",
                                "impact": "An attacker compromising '{principal}' gains immediate Domain Admin rights.",
                                "use_case": "Attackers map these ACL relationships to find the path of least resistance.",
                                "details": {"path": f"{principal} -> {right} -> {name}"}
                            })

        # Phase 3: Computer Audits
        for comp in computers:
            props = comp.get("Properties", {})
            name = props.get("name", "Unknown Computer")
            cid = comp.get("ObjectIdentifier", "")
            has_laps = props.get("haslaps", False) or props.get("lapsenabled", False)
            is_dc = props.get("isdc", False) or "DC" in name.upper() or "DOMAIN CONTROLLER" in props.get("description", "").upper()

            if len(comp_node["children"]) < 50:
                comp_node["children"].append({
                    "id": cid,
                    "name": name,
                    "type": "inner_rule",
                    "enabled": True
                })

            # LAPS
            if not has_laps and not is_dc:
                issues.append({
                    "category": "Privileges",
                    "severity": "Medium",
                    "title": "LAPS Not Enabled",
                    "description": f"Computer {name} does not have Windows LAPS configured.",
                    "impact": "Without LAPS, local admin passwords are often static and duplicated across hosts.",
                    "use_case": "Attackers dump local administrator credentials and perform lateral movement.",
                    "details": {"computer": name, "has_laps": False}
                })

            # SMB Signing
            if props.get("smb_signing_disabled") or props.get("smbsigning") == "Disabled":
                issues.append({
                    "category": "Privileges",
                    "severity": "Medium",
                    "title": "SMB Signing Disabled",
                    "description": f"Computer {name} has SMB Signing disabled or not required.",
                    "impact": "Allows attackers to perform NTLM Relay attacks and run remote commands.",
                    "use_case": "An attacker relays intercepted NTLM auth to the host to gain access.",
                    "details": {"computer": name, "smb_signing": "disabled"}
                })

            # Active Sessions
            sessions = comp.get("Sessions", []) or props.get("sessions", [])
            for session in sessions:
                user_name = session.get("UserName", session.get("User", "")).upper()
                if user_name in domain_admins_names and not is_dc:
                    issues.append({
                        "category": "Privileges",
                        "severity": "Critical",
                        "title": "High Privilege Account Active Session on Workstation",
                        "description": f"Domain Admin session ({user_name}) active on non-DC workstation '{name}'.",
                        "impact": "If the workstation is compromised, the Domain Admin's credentials can be extracted from LSASS memory.",
                        "use_case": "Attackers target workstations where Domain Admins are logged in to perform LSASS dumping.",
                        "details": {"user": user_name, "computer": name}
                    })

            # Local Admins / Local Administrator Rights Audit
            local_admins = comp.get("LocalAdmins", []) or props.get("localadmins", [])
            if len(local_admins) > 5:
                issues.append({
                    "category": "Privileges",
                    "severity": "Low",
                    "title": "Computers with High Count of Administrators",
                    "description": f"Computer {name} has {len(local_admins)} local administrators configured.",
                    "impact": "Excessive administrators increase the attack surface and potential for credential exposure.",
                    "use_case": "Attackers seek out hosts with many local admins as they present easier targets for initial local admin access.",
                    "details": {"computer": name, "admin_count": len(local_admins)}
                })

            for admin in local_admins:
                admin_name = admin.get("Name", "").upper()
                # Dangerous rights for domain users
                if "DOMAIN USERS" in admin_name or "EVERYONE" in admin_name or "AUTHENTICATED USERS" in admin_name:
                    issues.append({
                        "category": "Privileges",
                        "severity": "Critical",
                        "title": "Dangerous Permissions Granted to Domain Users",
                        "description": f"Generic group ({admin_name}) has local administrator rights on computer '{name}'.",
                        "impact": "Every domain user is a local administrator on this computer, leading to immediate compromise.",
                        "use_case": "Attackers use any low-privileged domain account to log in as administrator on the target computer.",
                        "details": {"computer": name, "group": admin_name}
                    })

        # Phase 4: GPO Auditing
        for gpo in gpos:
            props = gpo.get("Properties", {})
            gname = props.get("name", "Unnamed GPO")
            gpid = gpo.get("ObjectIdentifier", "")

            # GPO Permissions Security Risk
            for ace in gpo.get("Aces", []):
                right = ace.get("RightName", "")
                principal = ace.get("PrincipalName", "")
                if right in ["GenericAll", "GenericWrite", "WriteDacl", "WriteOwner"]:
                    if "DOMAIN ADMINS" not in principal.upper() and "ENTERPRISE ADMINS" not in principal.upper() and "SYSTEM" not in principal.upper():
                        issues.append({
                            "category": "Privileges",
                            "severity": "Critical",
                            "title": "GPO Permissions Security Risk",
                            "description": f"Non-admin principal '{principal}' has write permission '{right}' on GPO '{gname}'.",
                            "impact": "Allows attackers to edit the GPO and inject malicious startup scripts or registry edits applied domain-wide.",
                            "use_case": "An attacker modifies the GPO to push a ransomware payload to all workstations.",
                            "details": {"gpo": gname, "principal": principal, "right": right}
                        })

        # Phase 5: ADCS Auditing
        for template in cert_templates:
            props = template.get("Properties", {})
            tname = props.get("name", "Unnamed Template")
            enrollee_supplies_subject = props.get("enrollee_supplies_subject", False) or props.get("EnrolleeSuppliesSubject", False)
            client_auth = props.get("client_authentication", False) or props.get("ClientAuthentication", False)

            if enrollee_supplies_subject and client_auth:
                issues.append({
                    "category": "Privileges",
                    "severity": "Critical",
                    "title": "ADCS ESC1 Certificate Template Vulnerability",
                    "description": f"Certificate Template '{tname}' allows enrollees to supply Subject Alternative Name (SAN) and is enabled for Client Authentication.",
                    "impact": "Allows any domain user to request a certificate as a Domain Administrator, leading to instant domain compromise.",
                    "use_case": "Attackers request certificates masquerading as Domain Admins to authenticate via Kerberos.",
                    "details": {"template": tname, "esc_class": "ESC1"}
                })

        # Process Domain-level stats if present
        if "domain" in data or "domains" in data or "domain_stats" in data:
            domain_info = data.get("domain", data.get("domain_stats", {}))
            if isinstance(domain_info, list) and len(domain_info) > 0:
                domain_info = domain_info[0]

            # ad-13: SYSVOL GPP Password
            if domain_info.get("gpp_passwords_found") or data.get("gpp_passwords_found"):
                issues.append({
                    "category": "Privileges",
                    "severity": "Critical",
                    "title": "SYSVOL Group Policy Preferences Password Plaintext Exposed",
                    "description": "Plaintext passwords were found in SYSVOL Group Policy Preferences xml files.",
                    "impact": "SYSVOL is readable by all domain users, allowing instant decryption of password using public AES key.",
                    "use_case": "Attackers retrieve the password and compromise administrator-level accounts.",
                    "details": {"file": "Groups.xml", "gpp": True}
                })

            # ad-14: LDAP Signing Disabled
            if domain_info.get("ldap_signing_disabled") or data.get("ldap_signing_disabled"):
                issues.append({
                    "category": "Privileges",
                    "severity": "Medium",
                    "title": "LDAP Server Signing Not Required",
                    "description": "The Domain Controllers are configured to allow unsigned LDAP binds.",
                    "impact": "Enables LDAP/S credential relaying attacks to perform active directory object modifications.",
                    "use_case": "Attackers capture NTLM auth and relay it to LDAP to insert accounts into Domain Admins.",
                    "details": {"ldap_signing": "not_required"}
                })

            # ad-15: KRBTGT password old
            krbtgt_age = domain_info.get("krbtgt_password_age_years", data.get("krbtgt_password_age_years", 0))
            if krbtgt_age > 1.0:
                issues.append({
                    "category": "Stale Accounts",
                    "severity": "Info",
                    "title": "KRBTGT Password Has Not Been Reset Recently",
                    "description": f"The KRBTGT account password is {krbtgt_age} years old.",
                    "impact": "Old KRBTGT passwords allow forged Kerberos tickets (Golden Tickets) to remain active.",
                    "use_case": "Attackers forge Golden Tickets to retain permanent Domain Admin persistence.",
                    "details": {"user": "krbtgt", "password_age_years": krbtgt_age}
                })

        # Inject raw data for attack path visualization
        tree["raw_data"] = {
            "users": [
                {
                    "ObjectIdentifier": u.get("ObjectIdentifier", ""),
                    "Properties": u.get("Properties", {}),
                    "Aces": u.get("Aces", [])
                }
                for u in users
            ],
            "computers": [
                {
                    "ObjectIdentifier": c.get("ObjectIdentifier", ""),
                    "Properties": c.get("Properties", {}),
                    "Sessions": c.get("Sessions", []),
                    "LocalAdmins": c.get("LocalAdmins", [])
                }
                for c in computers
            ],
            "groups": [
                {
                    "ObjectIdentifier": g.get("ObjectIdentifier", ""),
                    "Properties": g.get("Properties", {}),
                    "Members": g.get("Members", [])
                }
                for g in groups
            ],
            "gpos": [
                {
                    "ObjectIdentifier": gp.get("ObjectIdentifier", ""),
                    "Properties": gp.get("Properties", {}),
                    "Aces": gp.get("Aces", [])
                }
                for gp in gpos
            ],
            "certificatetemplates": [
                {
                    "ObjectIdentifier": t.get("ObjectIdentifier", ""),
                    "Properties": t.get("Properties", {})
                }
                for t in cert_templates
            ]
        }

    def _parse_pingcastle_json(self, data, issues, stats, tree):
        stats["total_users"] = data.get("TotalUsers", 0)
        stats["total_computers"] = data.get("TotalComputers", 0)
        
        risks = data.get("RiskRules", [])
        for risk in risks:
            score = risk.get("Score", 0)
            severity = "Critical" if score >= 80 else "Medium" if score >= 50 else "Low"
            issues.append({
                "category": "Privileges" if "Privilege" in risk.get("Name", "") else "Stale Accounts",
                "severity": severity,
                "title": risk.get("Name", "AD Risk Identified"),
                "description": risk.get("Description", "No description available."),
                "details": risk
            })

    def _parse_pingcastle_xml(self, content, issues, stats, tree):
        try:
            root = ET.fromstring(content)
            for rule in root.findall(".//Rule"):
                name = rule.find("Name").text if rule.find("Name") is not None else "Unknown Rule"
                points = int(rule.find("Points").text) if rule.find("Points") is not None else 0
                
                if points > 0:
                    severity = "Critical" if points >= 30 else "Medium" if points >= 10 else "Low"
                    issues.append({
                        "category": "Privileges",
                        "severity": severity,
                        "title": name,
                        "description": "PingCastle identified a risk rule matching this domain.",
                        "details": {"points": points, "rule": name}
                    })
        except ET.ParseError:
            raise ValueError("Invalid PingCastle XML format.")
