"""
MantaInsight — Parser Registry

This module acts as a central registry for all brand-specific parsers.
To add a new parser:
  1. Create a new file in backend/parsers/ extending BaseParser
  2. Import it here and add it to PARSER_REGISTRY

Usage in server.py:
    from parsers import PARSER_REGISTRY
    parser_class = PARSER_REGISTRY.get("forescout")
    parser = parser_class()
    result = parser.parse(content, filename)
"""
from .forescout import ForescoutParser
from .beyondtrust import BeyondTrustParser
from .symantec_dlp import SymantecDLPParser
from .active_directory import ActiveDirectoryParser
from .local_exploit import LocalExploitParser

PARSER_REGISTRY = {
    "forescout":    ForescoutParser,
    "beyondtrust":  BeyondTrustParser,
    "symantec_dlp": SymantecDLPParser,
    "active_directory": ActiveDirectoryParser,
    "local_exploit": LocalExploitParser,
}

__all__ = ["PARSER_REGISTRY"]
