import xml.etree.ElementTree as ET
import ipaddress
import re

def ip_to_int(ip_str):
    try:
        return int(ipaddress.IPv4Address(ip_str.strip()))
    except Exception:
        return None

def int_to_ip(ip_int):
    try:
        return str(ipaddress.IPv4Address(ip_int))
    except Exception:
        return ""

def check_ranges_overlap(start1, end1, start2, end2):
    # Overlap criteria: start1 <= end2 and start2 <= end1
    if start1 <= end2 and start2 <= end1:
        # Determine overlap type
        if start1 == start2 and end1 == end2:
            return "identical"
        elif start1 <= start2 and end1 >= end2:
            return "subset"  # Range 2 is inside Range 1
        elif start2 <= start1 and end2 >= end1:
            return "superset"  # Range 1 is inside Range 2
        else:
            return "partial"
    return None

class ForescoutParser:
    def __init__(self, xml_content: str):
        self.xml_content = xml_content
        self.root = None
        self.folders = []
        self.policies = []
        self.rules = []
        self.inner_rules = []
        self.ranges_count = 0
        self.tree_data = None
        self.stats = {}
        self.issues = []
        
    def parse(self):
        try:
            # Handle XML namespace or stand-alone declarations if any
            # ElementTree parses standard XML string easily
            self.root = ET.fromstring(self.xml_content)
            
            # Extract tree representation
            self.tree_data = self._build_tree(self.root)
            
            # Analyze elements
            self._analyze_duplicates()
            self._analyze_ip_overlaps()
            self._analyze_hygiene_and_performance()
            
            # Post-process: assign sequential IDs and default status to issues
            for idx, issue in enumerate(self.issues):
                issue["id"] = f"issue_{idx + 1}"
                issue["resolved"] = False
                
            # Compute stats
            self.stats = {
                "total_folders": len(self.folders),
                "total_policies": len(self.policies),
                "total_rules": len(self.rules),
                "total_inner_rules": len(self.inner_rules),
                "total_ip_ranges": self.ranges_count,
                "disabled_policies": sum(1 for p in self.policies if p.get("enabled") == "false" or p.get("enabled") is False),
                "total_issues": len(self.issues),
                "high_issues": sum(1 for i in self.issues if i["severity"] == "High"),
                "medium_issues": sum(1 for i in self.issues if i["severity"] == "Medium"),
                "low_issues": sum(1 for i in self.issues if i["severity"] == "Low"),
                "info_issues": sum(1 for i in self.issues if i["severity"] == "Info")
            }
            
            return {
                "stats": self.stats,
                "issues": self.issues,
                "tree": self.tree_data
            }
        except Exception as e:
            import traceback
            print("Error parsing XML:", e)
            print(traceback.format_exc())
            raise ValueError(f"Invalid Forescout Policy XML format: {str(e)}")

    def _build_tree(self, node):
        tag = node.tag
        node_id = node.get("ID", "")
        name = node.get("NAME", "")
        
        if tag == "POLICY_FOLDER":
            folder_info = {
                "type": "folder",
                "id": node_id,
                "name": name or "Unnamed Folder",
                "children": []
            }
            self.folders.append(folder_info)
            
            # A POLICY_FOLDER can have multiple subfolders or a POLICIES node
            for child in node:
                if child.tag == "POLICY_FOLDER":
                    folder_info["children"].append(self._build_tree(child))
                elif child.tag == "POLICIES":
                    for policy_node in child.findall("POLICY"):
                        folder_info["children"].append(self._build_tree(policy_node))
            return folder_info
            
        elif tag == "POLICY":
            # POLICY usually has a nested RULE inside it
            rule_node = node.find("RULE")
            policy_id = node_id or (rule_node.get("ID") if rule_node is not None else "")
            policy_name = name or (rule_node.get("NAME") if rule_node is not None else "Unnamed Policy")
            enabled_attr = rule_node.get("ENABLED", "true") if rule_node is not None else "true"
            enabled = enabled_attr.lower() == "true"
            
            policy_info = {
                "type": "policy",
                "id": policy_id,
                "name": policy_name,
                "enabled": enabled,
                "description": (rule_node.get("DESCRIPTION", "") if rule_node is not None else ""),
                "children": []
            }
            self.policies.append(policy_info)
            
            if rule_node is not None:
                policy_info["children"].append(self._build_tree(rule_node))
            return policy_info
            
        elif tag == "RULE" or tag == "INNER_RULE":
            is_inner = (tag == "INNER_RULE")
            enabled = node.get("ENABLED", "true").lower() == "true"
            cache_ttl = node.get("CACHE_TTL", "")
            
            # Parse IP scopes (SEGMENT & RANGE)
            ranges = []
            for segment in node.findall("SEGMENT"):
                seg_name = segment.get("NAME", "")
                seg_id = segment.get("ID", "")
                for r_elem in segment.findall("RANGE"):
                    from_ip = r_elem.get("FROM", "")
                    to_ip = r_elem.get("TO", "")
                    if from_ip and to_ip:
                        f_int = ip_to_int(from_ip)
                        t_int = ip_to_int(to_ip)
                        if f_int is not None and t_int is not None:
                            ranges.append({
                                "from": from_ip,
                                "to": to_ip,
                                "from_int": f_int,
                                "to_int": t_int,
                                "segment_name": seg_name,
                                "segment_id": seg_id
                            })
                            self.ranges_count += 1
            
            # Parse actions
            actions = []
            for act in node.findall(".//ACTION"):
                act_disabled = act.get("DISABLED", "false").lower() == "true"
                act_name = act.get("NAME", "")
                params = {}
                for p in act.findall("PARAM"):
                    p_name = p.get("NAME", "")
                    p_val = p.get("VALUE", "")
                    params[p_name] = p_val
                
                actions.append({
                    "name": act_name,
                    "disabled": act_disabled,
                    "params": params
                })
                
            # Parse conditions/expressions
            conditions = []
            # We can extract all <CONDITION> tags nested under the rule
            for cond in node.findall(".//CONDITION"):
                field_name = cond.get("FIELD_NAME", "")
                label = cond.get("LABEL", "")
                logic = cond.get("LOGIC", "AND")
                
                filters = []
                for f in cond.findall("FILTER"):
                    val = f.get("VALUE", "") or f.get("VALUE2", "")
                    # Option nested inside filter
                    opt_vals = [opt.get("VALUE", "") for opt in f.findall("OPT")]
                    path_vals = [path.get("VALUE", "") for path in f.findall("PATH")]
                    
                    filters.append({
                        "value": val,
                        "options": opt_vals,
                        "paths": path_vals,
                        "type": f.get("TYPE", "")
                    })
                
                conditions.append({
                    "field": field_name,
                    "label": label,
                    "logic": logic,
                    "filters": filters
                })

            rule_info = {
                "type": "inner_rule" if is_inner else "rule",
                "id": node_id,
                "name": name or "Unnamed Rule",
                "enabled": enabled,
                "cache_ttl": cache_ttl,
                "description": node.get("DESCRIPTION", ""),
                "ranges": ranges,
                "actions": actions,
                "conditions": conditions,
                "children": []
            }
            
            if is_inner:
                self.inner_rules.append(rule_info)
            else:
                self.rules.append(rule_info)
                
            # If main rule, parse rule chain (sub-rules/inner-rules)
            rule_chain = node.find("RULE_CHAIN")
            if rule_chain is not None:
                for inner_rule_node in rule_chain.findall("INNER_RULE"):
                    rule_info["children"].append(self._build_tree(inner_rule_node))
                    
            return rule_info
            
        # Default fallback for other nodes
        return {"type": "unknown", "name": name or tag}

    def _analyze_duplicates(self):
        # We check duplicates by name
        rule_map = {}
        
        # Collect names for main rules and inner rules
        for rule in self.rules:
            name = rule["name"]
            if name:
                rule_map.setdefault(name, []).append((rule["id"], "Main Rule", rule["enabled"]))
                
        for ir in self.inner_rules:
            name = ir["name"]
            if name:
                rule_map.setdefault(name, []).append((ir["id"], "Inner Sub-Rule", ir["enabled"]))
                
        # Register duplicate issues
        for name, occurrences in rule_map.items():
            if len(occurrences) > 1:
                # Group duplicates
                main_count = sum(1 for o in occurrences if o[1] == "Main Rule")
                inner_count = sum(1 for o in occurrences if o[1] == "Inner Sub-Rule")
                
                detail_str = f"Found {len(occurrences)} rules named '{name}' ({main_count} main rules, {inner_count} sub-rules)."
                
                self.issues.append({
                    "category": "Duplicates",
                    "title": f"Duplicate Rule Name: '{name}'",
                    "description": detail_str,
                    "severity": "Low",  # Low severity, it is an administrative/maintenance issue
                    "details": {
                        "rule_name": name,
                        "occurrences": [{"id": o[0], "type": o[1], "enabled": o[2]} for o in occurrences]
                    }
                })

    def _analyze_ip_overlaps(self):
        # We check overlaps among main rules that have segments
        # Let's gather rules that have non-empty ranges
        active_rules = []
        for r in self.rules:
            # We check ranges
            if r["ranges"]:
                active_rules.append(r)
                
        # Compare rules pairwise
        overlap_pairs = []
        for i in range(len(active_rules)):
            for j in range(i + 1, len(active_rules)):
                r1 = active_rules[i]
                r2 = active_rules[j]
                
                # Check for overlap between their range sets
                overlapping_ranges = []
                for rg1 in r1["ranges"]:
                    for rg2 in r2["ranges"]:
                        overlap_type = check_ranges_overlap(
                            rg1["from_int"], rg1["to_int"],
                            rg2["from_int"], rg2["to_int"]
                        )
                        if overlap_type:
                            overlapping_ranges.append({
                                "range_a": f"{rg1['from']} - {rg1['to']}",
                                "segment_a": rg1["segment_name"],
                                "range_b": f"{rg2['from']} - {rg2['to']}",
                                "segment_b": rg2["segment_name"],
                                "type": overlap_type
                            })
                            
                if overlapping_ranges:
                    # Determine severity:
                    # If ranges are identical and both are enabled -> Medium (or High if actions conflict)
                    # If subset/partial -> Medium
                    # If one is disabled -> Info
                    both_enabled = r1["enabled"] and r2["enabled"]
                    severity = "Medium" if both_enabled else "Info"
                    
                    self.issues.append({
                        "category": "IP Overlaps",
                        "title": f"IP Range Overlap: '{r1['name']}' & '{r2['name']}'",
                        "description": f"Rules '{r1['name']}' and '{r2['name']}' target overlapping IP scopes. Found {len(overlapping_ranges)} overlapping range segments.",
                        "severity": severity,
                        "details": {
                            "rule_a": {"id": r1["id"], "name": r1["name"], "enabled": r1["enabled"]},
                            "rule_b": {"id": r2["id"], "name": r2["name"], "enabled": r2["enabled"]},
                            "overlaps": overlapping_ranges
                        }
                    })

    def _analyze_hygiene_and_performance(self):
        # Scan rules & inner rules for hygiene/performance issues
        all_items = self.rules + self.inner_rules
        
        for item in all_items:
            item_type = "Main Rule" if item["type"] == "rule" else "Inner Sub-Rule"
            name = item["name"]
            item_id = item["id"]
            
            # --- HYGIENE AUDITS ---
            # 1. Disabled policy/rule check
            if not item["enabled"]:
                self.issues.append({
                    "category": "Hygiene",
                    "title": f"Disabled {item_type}: '{name}'",
                    "description": f"The {item_type.lower()} '{name}' is currently disabled in the configuration.",
                    "severity": "Info",
                    "details": {"id": item_id, "name": name, "type": item_type}
                })
                
            # 2. No-Action check for inner rules (if enabled)
            if item["type"] == "inner_rule" and item["enabled"]:
                active_actions = [a for a in item["actions"] if not a["disabled"]]
                if not active_actions:
                    self.issues.append({
                        "category": "Hygiene",
                        "title": f"No Active Actions: '{name}'",
                        "description": f"The sub-rule '{name}' is enabled but has no active actions. It will evaluate conditions but execute nothing.",
                        "severity": "Medium",
                        "details": {"id": item_id, "name": name, "type": item_type}
                    })
                    
            # 3. Empty conditions/expressions check (if enabled)
            if item["enabled"] and not item["conditions"] and item["type"] == "inner_rule":
                # For an inner rule, an empty condition means it matches *everything* entering this path of the chain!
                # This is a HIGH risk if there are actions (e.g. putting things in quarantine or groups without filter)
                # Note: The very last inner rule might be a fallback (e.g. name "Unclassified" or "Other" or "Fallback")
                is_fallback = any(fb in name.lower() for fb in ["other", "unclassified", "fallback", "default"])
                severity = "Low" if is_fallback else "High"
                
                self.issues.append({
                    "category": "Hygiene",
                    "title": f"Empty Conditions: '{name}'",
                    "description": f"The sub-rule '{name}' has no filter conditions. It will unconditionally match all devices reaching it.",
                    "severity": severity,
                    "details": {"id": item_id, "name": name, "type": item_type}
                })

            # --- PERFORMANCE AUDITS ---
            # 4. Low Cache TTL
            # TTL is defined as attribute CACHE_TTL (in seconds).
            ttl_str = item.get("cache_ttl", "")
            if ttl_str and item["enabled"]:
                try:
                    ttl_val = int(ttl_str)
                    # Cache TTL of 0 means "re-evaluate constantly". Very low caching values (e.g. < 300s) cause high loads
                    if ttl_val == 0:
                        self.issues.append({
                            "category": "Performance",
                            "title": f"Caching Disabled: '{name}'",
                            "description": f"The rule '{name}' has CACHE_TTL set to 0. Caching is disabled, forcing continuous re-evaluation of endpoints.",
                            "severity": "High",
                            "details": {"id": item_id, "name": name, "ttl": 0, "type": item_type}
                        })
                    elif ttl_val < 3600:  # less than 1 hour
                        self.issues.append({
                            "category": "Performance",
                            "title": f"Low Cache TTL: '{name}'",
                            "description": f"The rule '{name}' has a cache TTL of {ttl_val} seconds (less than 1 hour). Low cache intervals increase appliance workload.",
                            "severity": "Low",
                            "details": {"id": item_id, "name": name, "ttl": ttl_val, "type": item_type}
                        })
                except ValueError:
                    pass

if __name__ == "__main__":
    # Quick self-test when running the file directly
    import sys
    xml_file = "/Users/macbookpro/ErwanzCode/Mantainsight/Sample/Policy Folders Existing - Forescout.xml"
    try:
        with open(xml_file, 'r', encoding='utf-8') as f:
            content = f.read()
        parser = ForescoutParser(content)
        result = parser.parse()
        print("Self-test output stats:")
        print(result["stats"])
        print(f"Total issues found: {len(result['issues'])}")
        # Print counts by category
        from collections import Counter
        cats = Counter(i["category"] for i in result["issues"])
        print("Issues by category:", dict(cats))
    except Exception as e:
        print("Self-test error:", e)
