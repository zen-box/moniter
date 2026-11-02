"""Check the actual release executable reaches certificate verification without panicking."""
import base64
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]


def verify(binary):
    fixtures = ROOT / "agent/tests/fixtures"
    with tempfile.TemporaryDirectory(prefix="moniter-agent-tls-") as directory:
        temporary = Path(directory)
        cert = temporary / "localhost.pem"
        cert.write_text(ssl.DER_cert_to_PEM_cert((fixtures / "localhost-cert.der").read_bytes()), encoding="ascii")
        key = temporary / "localhost-key.pem"
        key.write_text("-----BEGIN PRIVATE KEY-----\n" + base64.encodebytes(
            (fixtures / "localhost-key.der").read_bytes()).decode("ascii") + "-----END PRIVATE KEY-----\n", encoding="ascii")
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            listener.settimeout(15)
            port = listener.getsockname()[1]
            rejected = threading.Event()

            def accept():
                try:
                    tcp, _ = listener.accept()
                    with tcp:
                        tcp.settimeout(10)
                        with context.wrap_socket(tcp, server_side=True):
                            pass
                except ssl.SSLError:
                    rejected.set()
                except OSError:
                    pass

            worker = threading.Thread(target=accept, daemon=True)
            worker.start()
            env = {**os.environ, "AEGIS_AGENT_TOKEN": "fixture-node-token"}
            env.pop("AEGIS_AGENT_TOKEN_FILE", None)
            with (temporary / "agent.log").open("wb") as output:
                process = subprocess.Popen([str(binary), "--server", f"wss://127.0.0.1:{port}/ws/agent"],
                                           stdout=output, stderr=subprocess.STDOUT, env=env)
                try:
                    deadline = time.monotonic() + 15
                    while time.monotonic() < deadline:
                        log = (temporary / "agent.log").read_text(encoding="utf-8", errors="replace")
                        if process.poll() is not None:
                            raise AssertionError(f"Agent exited with {process.returncode}:\n{log}")
                        if "UnknownIssuer" in log:
                            assert "panicked" not in log and "CryptoProvider" not in log, log
                            assert rejected.wait(2), "fixture did not observe the rejected TLS handshake"
                            print("Release Agent: TLS initializes, unknown CA rejected, reconnect loop remains alive")
                            break
                        time.sleep(0.05)
                    else:
                        raise AssertionError(f"Agent did not reach TLS certificate verification:\n{log}")
                finally:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
            worker.join(timeout=2)


if __name__ == "__main__":
    verify(Path(sys.argv[1]).resolve(strict=True))
