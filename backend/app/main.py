from dataclasses import asdict

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from app.schemas import CaptureRequest, CaptureResponse
from app.services.yomitan import YomitanError, YomitanService

app = FastAPI(title="AnkiMiner Local API")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"chrome-extension://.*",
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
)


@app.post("/api/capture", response_model=CaptureResponse)
def capture_term(request: CaptureRequest) -> CaptureResponse:
    service = YomitanService()
    try:
        term = service.identify(request.text)
    except YomitanError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error
    enriched = service.enrich(term)
    return CaptureResponse(
        expression=enriched.expression,
        reading=enriched.reading,
        source_text=enriched.source_text,
        deinflected_text=enriched.deinflected_text,
        entries=[asdict(entry) for entry in enriched.entries],
        dictionary_error=enriched.dictionary_error,
    )
