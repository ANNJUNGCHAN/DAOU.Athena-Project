"""Athena API routers."""

from fastapi import APIRouter

from athena_api.api.batch import router as batch_router
from athena_api.api.catalog import router as catalog_router
from athena_api.api.llm_tools import router as llm_tools_router
from athena_api.api.oauth_status import router as oauth_status_router
from athena_api.api.raw import router as raw_router
from athena_api.api.routines import router as routines_router
from athena_api.api.routines_ws import router as routines_ws_router
from athena_api.api.stream import router as stream_router
from athena_api.generated.routes import router as generated_router

router = APIRouter()
router.include_router(generated_router)
router.include_router(batch_router)
router.include_router(catalog_router)
router.include_router(llm_tools_router)
router.include_router(oauth_status_router)
router.include_router(raw_router)
router.include_router(routines_router)
router.include_router(routines_ws_router)
router.include_router(stream_router)

__all__ = ["router"]
