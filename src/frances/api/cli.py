"""Comando ``frances serve``: API HTTP con un solo proceso de uvicorn."""

import typer
import uvicorn

from frances.api.app import api_context_from_env, create_app
from frances.errors import FrancesError
from frances.log import redact


def register(app: typer.Typer) -> None:
    @app.command("serve")
    def serve(
        host: str = typer.Option("127.0.0.1", "--host", help="Interfaz de escucha"),
        port: int = typer.Option(8000, "--port", help="Puerto de escucha"),
    ) -> None:
        """Sirve la API `/api/*` (migra la base antes de arrancar)."""
        try:
            ctx = api_context_from_env()
        except FrancesError as exc:
            typer.echo(redact(str(exc)), err=True)
            raise typer.Exit(exc.exit_code) from exc
        uvicorn.run(
            create_app(lambda: ctx),
            host=host,
            port=port,
            workers=1,
            proxy_headers=True,
            forwarded_allow_ips="*",
            access_log=False,
            server_header=False,
        )
