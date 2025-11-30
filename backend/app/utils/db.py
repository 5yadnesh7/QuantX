from functools import lru_cache
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
  mongodb_uri: str = "mongodb://mongodb:27017"
  mongodb_db: str = "quantx"

  class Config:
    env_prefix = "QUANTX_"


_client: Optional[AsyncIOMotorClient] = None


@lru_cache
def get_settings() -> Settings:
  return Settings()


def get_client() -> AsyncIOMotorClient:
  global _client
  if _client is None:
    settings = get_settings()
    _client = AsyncIOMotorClient(settings.mongodb_uri)
  return _client


def get_db() -> AsyncIOMotorDatabase:
  settings = get_settings()
  return get_client()[settings.mongodb_db]
