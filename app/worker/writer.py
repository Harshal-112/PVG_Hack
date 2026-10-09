"""Stream consumer worker that writes confirmed bookings to Postgres. Owned by [P3]."""

import asyncio
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main():
    """Writer worker entry point."""
    logger.info("Writer worker scaffold running, awaiting P3 implementation...")
    while True:
        await asyncio.sleep(3600)


if __name__ == "__main__":
    asyncio.run(main())
