#!/usr/bin/env python3
"""
Fetch current 6-digit TOTP code from X_TEST_TOTP_URL endpoint.
Waits for refresh if the current code is close to expiring (<= 4s).
"""

import os
import re
import sys
import time
import urllib.request


def fetch_totp(url: str, min_ttl: int = 4, max_retries: int = 15) -> str:
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "RobinE2ETest/1.0"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read().decode("utf-8")

            # Look for 6-digit TOTP code in response
            m_code = re.search(r'class="code">(\d{6})<', body)
            if not m_code:
                # Fallback: search for any standalone 6-digit code or JSON field
                m_code = re.search(r'(?:"code"\s*:\s*"|class="[^"]*code[^"]*">|\b)(\d{6})\b', body)

            m_exp = re.search(r'expires in (\d+)s', body)
            ttl = int(m_exp.group(1)) if m_exp else 30

            if m_code:
                code = m_code.group(1)
                if ttl <= min_ttl:
                    # Token will expire soon; wait for next cycle so test doesn't fail in-flight
                    time.sleep(ttl + 1)
                    continue
                return code
        except Exception as err:
            if attempt == max_retries - 1:
                raise RuntimeError(f"Failed to fetch TOTP code after {max_retries} attempts: {err}") from err
            time.sleep(1)

    raise RuntimeError("Timed out waiting for valid TOTP code")


def main() -> None:
    url = os.environ.get("X_TEST_TOTP_URL")
    if not url:
        sys.stderr.write("Error: X_TEST_TOTP_URL environment variable is required.\n")
        sys.exit(1)

    try:
        code = fetch_totp(url)
        print(code)
    except Exception as exc:
        sys.stderr.write(f"Error fetching TOTP: {exc}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
