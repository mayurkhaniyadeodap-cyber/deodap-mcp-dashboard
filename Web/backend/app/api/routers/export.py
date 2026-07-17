"""Export routes — dataset catalog + CSV/XLSX download.

Writes are role-gated: Viewers cannot export (read-only). The mock produces a
real downloadable file; Phase 2 only swaps the row source in the service.
"""

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status

from app.api.deps import DateRange, date_range_params, get_current_user, require_role
from app.auth.roles import Role
from app.schemas.export import ExportCatalog
from app.services import export_service

router = APIRouter(tags=["export"])

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
