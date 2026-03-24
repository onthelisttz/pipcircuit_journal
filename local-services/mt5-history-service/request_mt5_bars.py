import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--timeframe", required=True)
    parser.add_argument("--from", dest="from_value", required=True)
    parser.add_argument("--to", dest="to_value", required=True)
    parser.add_argument("--history-root", dest="history_root", default="")
    parser.add_argument("--return-bars", dest="return_bars", action="store_true")
    return parser.parse_args()


def is_terminal_running(process_names: list[str]) -> bool:

    try:
        result = subprocess.run(
            ["tasklist", "/fo", "csv", "/nh"],
            capture_output=True,
            text=True,
            check=True,
        )
    except Exception:
        return False

    running_names = []
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        parts = [part.strip().strip('"') for part in line.split('","')]
        if parts:
            running_names.append(parts[0].lower())

    return any(name in running_names for name in process_names)


def read_text_file(path: str) -> str:
    with open(path, "rb") as file_handle:
        raw = file_handle.read()

    for encoding in ("utf-8", "utf-8-sig", "utf-16", "utf-16-le", "utf-16-be"):
        try:
            return raw.decode(encoding).strip()
        except UnicodeDecodeError:
            continue

    return raw.decode("latin-1", errors="ignore").strip()


def resolve_terminal_path(history_root: str) -> str:
    candidates: list[str] = []

    if history_root:
        normalized = os.path.normpath(history_root)
        parts = normalized.split(os.sep)
        try:
            terminal_index = parts.index("Terminal")
        except ValueError:
            terminal_index = -1
        if terminal_index >= 0 and terminal_index + 1 < len(parts):
            data_root = os.sep.join(parts[: terminal_index + 2])
            origin_path = os.path.join(data_root, "origin.txt")
            if os.path.exists(origin_path):
                try:
                    install_root = read_text_file(origin_path)
                    if install_root:
                        candidates.extend(
                            [
                                os.path.join(install_root, "terminal64.exe"),
                                os.path.join(install_root, "terminal.exe"),
                            ]
                        )
                except OSError:
                    pass

    program_files = [
        os.environ.get("ProgramFiles", ""),
        os.environ.get("ProgramFiles(x86)", ""),
    ]
    for base in program_files:
        if base:
            candidates.extend(
                [
                    os.path.join(base, "MetaTrader 5", "terminal64.exe"),
                    os.path.join(base, "MetaTrader 5", "terminal.exe"),
                ]
            )

    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate

    return ""


def launch_terminal_background(executable_path: str) -> None:
    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startupinfo.wShowWindow = 7  # SW_SHOWMINNOACTIVE
    subprocess.Popen(
        [executable_path],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        startupinfo=startupinfo,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )


def wait_for_terminal(process_names: list[str], timeout_seconds: float = 12.0) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
      if is_terminal_running(process_names):
        return True
      time.sleep(0.5)
    return False


def main() -> int:
    args = parse_args()

    try:
        import MetaTrader5 as mt5  # type: ignore
    except ImportError as error:
        print(
            f"MetaTrader5 bridge import failed: {error}. Install with: python -m pip install MetaTrader5",
            file=sys.stderr,
        )
        return 1

    timeframe_name = f"TIMEFRAME_{args.timeframe.upper()}"
    timeframe_value = getattr(mt5, timeframe_name, None)
    if timeframe_value is None:
        print(f"Unsupported timeframe: {args.timeframe}", file=sys.stderr)
        return 1

    from_dt = datetime.fromisoformat(args.from_value.replace("Z", "+00:00")).astimezone(timezone.utc)
    to_dt = datetime.fromisoformat(args.to_value.replace("Z", "+00:00")).astimezone(timezone.utc)
    terminal_path = resolve_terminal_path(args.history_root)
    process_names = [name for name in ["terminal64.exe", "terminal.exe"]]
    if terminal_path:
        process_names.insert(0, os.path.basename(terminal_path).lower())

    initialized = False
    try:
        if not is_terminal_running(process_names):
            if not terminal_path:
                print(
                    "Could not auto-detect the MetaTrader 5 terminal executable.",
                    file=sys.stderr,
                )
                return 1
            launch_terminal_background(terminal_path)
            if not wait_for_terminal(process_names):
                print(
                    "MetaTrader 5 was started in the background but did not become ready in time.",
                    file=sys.stderr,
                )
                return 1

        if terminal_path:
            initialized = mt5.initialize(path=terminal_path)
        else:
            initialized = mt5.initialize()
        if not initialized:
            print(f"MT5 initialize failed: {mt5.last_error()}", file=sys.stderr)
            return 1

        if not mt5.symbol_select(args.symbol, True):
            print(f"Could not select symbol {args.symbol}: {mt5.last_error()}", file=sys.stderr)
            return 1

        rates = mt5.copy_rates_range(args.symbol, timeframe_value, from_dt, to_dt)
        if rates is None:
            print(f"MT5 copy_rates_range failed: {mt5.last_error()}", file=sys.stderr)
            return 1

        count = len(rates)
        first_timestamp = int(rates[0]["time"]) * 1000 if count > 0 else None
        last_timestamp = int(rates[-1]["time"]) * 1000 if count > 0 else None
        bars = None
        if args.return_bars:
            bars = [
                {
                    "timestamp": int(rate["time"]) * 1000,
                    "open": float(rate["open"]),
                    "high": float(rate["high"]),
                    "low": float(rate["low"]),
                    "close": float(rate["close"]),
                    "volume": int(rate["tick_volume"]),
                }
                for rate in rates
            ]

        print(
            json.dumps(
                {
                    "symbol": args.symbol,
                    "timeframe": args.timeframe,
                    "requestedFrom": from_dt.isoformat(),
                    "requestedTo": to_dt.isoformat(),
                    "terminalPath": terminal_path or None,
                    "count": count,
                    "firstTimestamp": first_timestamp,
                    "lastTimestamp": last_timestamp,
                    "bars": bars,
                }
            )
        )
        return 0
    finally:
        if initialized:
            mt5.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())

