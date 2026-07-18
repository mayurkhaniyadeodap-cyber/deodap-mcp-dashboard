"""Export routes — dataset catalog + CSV/XLSX download.

Writes are role-gated: Viewers cannot export (read-only). The mock produces a
real downloadable file; Phase 2 only swaps the row source in the service.
"""

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status

from app.api.deps import DateRange, date_range_params, get_current_user, require_role
from app.auth.roles import Role
from app.schemas.export import ExportCatalog
from app.services import discrepancy_service, export_service

router = APIRouter(tags=["export"])

# Dispute Lines export columns — all row fields + invoice_no (the carrier artifact).
_DISPUTE_LINE_HEADERS = [
    "awb", "invoice_no", "courier", "order_date", "is_rto",
    "applied_weight_kg", "invoiced_weight_kg", "weight_diff_kg",
    "applied_rate", "invoiced_rate", "rate_diff", "status",
]
# Invoice-summary export — one row per carrier invoice.
_DISPUTE_INVOICE_HEADERS = [
    "invoice_no", "courier", "line_count", "rate_diff_total", "date_from", "date_to",
]

# Everyone signed-in can see the catalog...
@router.get("/export", response_model=ExportCatalog, dependencies=[Depends(get_current_user)])
def export_catalog() -> ExportCatalog:
    return export_service.catalog()


# ...but only non-Viewer roles can actually download a file.
@router.get(
    "/export/{fmt}",
    dependencies=[Depends(require_role(Role.admin, Role.employee))],
)
async def export_file(
    fmt: str = Path(pattern="^(csv|xlsx)$"),
    dataset: str = Query(default="bills"),
    dates: DateRange = Depends(date_range_params),
) -> Response:
    if not export_service.is_valid_dataset(dataset):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown dataset")
    content, media_type, filename = await export_service.render(
        dataset, fmt, date_from=dates.date_from, date_to=dates.date_to
    )
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/disputes/lines/export/{fmt}",
    dependencies=[Depends(require_role(Role.admin, Role.employee))],
    tags=["discrepancies"],
)
async def export_dispute_lines(
    fmt: str = Path(pattern="^(csv|xlsx)$"),
    dates: DateRange = Depends(date_range_params),
    min_diff: float = Query(default=50, ge=0),
    sort_by: str = Query(default="rate_diff", pattern="^(rate_diff|weight_diff)$"),
    courier_slug: str | None = Query(default=None),
    invoice_no: str | None = Query(default=None),
) -> Response:
    """CSV/XLSX of the CURRENT filtered dispute-line set — the artifact ops sends
    to carriers. Reuses the export renderer; builds the set inline if the page
    hasn't warmed it yet."""
    lines = await discrepancy_service.get_dispute_lines_full(
        date_from=dates.date_from, date_to=dates.date_to, min_diff=min_diff,
        sort_by=sort_by, courier_slug=courier_slug, invoice_no=invoice_no,
    )
    rows = [ln.model_dump(mode="json") for ln in lines]
    content, media_type = export_service._render_bytes(_DISPUTE_LINE_HEADERS, rows, fmt, "Dispute Lines")
    suffix = f"_{dates.date_from}_{dates.date_to}" if dates.date_from and dates.date_to else ""
    filename = f"deodap_dispute_lines{suffix}.{fmt}"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/disputes/invoices/export/{fmt}",
    dependencies=[Depends(require_role(Role.admin, Role.employee))],
    tags=["discrepancies"],
)
async def export_dispute_invoices(
    fmt: str = Path(pattern="^(csv|xlsx)$"),
    dates: DateRange = Depends(date_range_params),
    min_diff: float = Query(default=50, ge=0),
    courier_slug: str | None = Query(default=None),
    invoice_no: str | None = Query(default=None),
) -> Response:
    """CSV/XLSX invoice SUMMARY (one row per carrier invoice) for the current filter —
    the artifact a carrier contact acts on. Line-item export stays separate."""
    invoices = await discrepancy_service.get_dispute_invoices_full(
        date_from=dates.date_from, date_to=dates.date_to, min_diff=min_diff,
        courier_slug=courier_slug, invoice_no=invoice_no,
    )
    rows = [g.model_dump(mode="json") for g in invoices]
    content, media_type = export_service._render_bytes(_DISPUTE_INVOICE_HEADERS, rows, fmt, "Dispute Invoices")
    suffix = f"_{dates.date_from}_{dates.date_to}" if dates.date_from and dates.date_to else ""
    filename = f"deodap_dispute_invoices{suffix}.{fmt}"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
