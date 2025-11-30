from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings
from redis.asyncio import Redis


class CacheSettings(BaseSettings):
  redis_url: str = "redis://redis:6379/0"

  class Config:
    env_prefix = "QUANTX_"


_redis: Optional[Redis] = None


@lru_cache
def get_cache_settings() -> CacheSettings:
  return CacheSettings()


def get_redis_client() -> Redis:
  global _redis
  if _redis is None:
    settings = get_cache_settings()
    _redis = Redis.from_url(settings.redis_url, decode_responses=True)
  return _redis
