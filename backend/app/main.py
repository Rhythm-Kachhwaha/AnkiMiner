from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from app.db.connection import init_db
from app.schemas import (
    AnkiDecksResponse,
    AnkiModelsResponse,
    AnkiStatusResponse,
    CaptureRequest,
    CaptureResponse,
    SaveCardRequest,
    SaveCardResponse,
    SyncCardResponse,
)
from app.services.card_service import CardService
from app.services.yomitan import YomitanError, YomitanService


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="AnkiMiner Local API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(chrome-extension://.*|http://(localhost|127\.0\.0\.1)(:\d+)?)$",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/capture", response_model=CaptureResponse)
def capture_term(request: CaptureRequest) -> CaptureResponse:
    service = CardService(yomitan_service=YomitanService())
    try:
        if request.auto_save:
            return service.capture_and_save(request.text, request.deck_name)
        return service.capture_term(request.text, request.deck_name)
    except YomitanError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error


@app.post("/api/cards/save", response_model=SaveCardResponse)
@app.post("/api/card/save", response_model=SaveCardResponse)
def save_card(request: SaveCardRequest) -> SaveCardResponse:
    service = CardService()
    return service.save_card(request)


@app.get("/api/anki/status", response_model=AnkiStatusResponse)
def get_anki_status() -> AnkiStatusResponse:
    service = CardService()
    return service.get_anki_status()


@app.get("/api/anki/decks", response_model=AnkiDecksResponse)
def get_anki_decks() -> AnkiDecksResponse:
    service = CardService()
    return service.get_anki_decks()


@app.get("/api/anki/models", response_model=AnkiModelsResponse)
def get_anki_models() -> AnkiModelsResponse:
    service = CardService()
    return service.get_anki_models()


@app.post("/api/cards/{card_id}/sync", response_model=SyncCardResponse)
def sync_card(card_id: int) -> SyncCardResponse:
    service = CardService()
    try:
        return service.sync_card(card_id)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


