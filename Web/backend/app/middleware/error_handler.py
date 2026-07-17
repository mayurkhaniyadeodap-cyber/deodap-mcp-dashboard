"""Uniform JSON error envelope so the frontend always gets a predictable shape."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


def _envelope(status_code: int, message: str, request: Request, detail=None) -> JSONResponse:
    body = {
        "error": {
            "status": status_code,
            "message": message,
            "request_id": getattr(request.state, "request_id", None),
        }
    }
    if detail is not None:
        body["error"]["detail"] = detail
    return JSONResponse(status_code=status_code, content=body)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_exc(request: Request, exc: StarletteHTTPException):
        return _envelope(exc.status_code, str(exc.detail), request)

    @app.exception_handler(RequestValidationError)
    async def validation_exc(request: Request, exc: RequestValidationError):
        return _envelope(422, "Validation error", request, detail=exc.errors())

    @app.exception_handler(Exception)
    async def unhandled_exc(request: Request, exc: Exception):
        return _envelope(500, "Internal server error", request)
