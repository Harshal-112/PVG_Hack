"""Event catalog service for Event Discovery and Search.

Stores and queries event metadata with real availability stats.
"""

from typing import Optional

EVENTS_DATA = [
    {
        "event_id": "evt1",
        "name": "High-Contention Arena Grand Finale",
        "venue": "Grand Pavilion Arena, Hall A",
        "date": "2026-11-15T19:00:00Z",
        "category": "Concert",
        "description": "Live flash-sale event with 200 real-time contention-free seats and sub-second locking.",
        "seat_count": 200,
        "price": 45.00,
        "currency": "USD",
        "image_url": "/ui/assets/event1.jpg",
    },
    {
        "event_id": "evt2",
        "name": "Tech Innovation Summit 2026",
        "venue": "Silicon Center Auditorium",
        "date": "2026-12-01T10:00:00Z",
        "category": "Conference",
        "description": "Annual gathering of systems architects, distributed systems developers, and high-performance engineers.",
        "seat_count": 150,
        "price": 120.00,
        "currency": "USD",
        "image_url": "/ui/assets/event2.jpg",
    },
    {
        "event_id": "evt3",
        "name": "Cyberpunk Symphony Orchestra",
        "venue": "Metropolis Philharmonic Center",
        "date": "2026-12-20T20:30:00Z",
        "category": "Music",
        "description": "An immersive neoclassical synth performance with multi-channel audio projection and laser array.",
        "seat_count": 100,
        "price": 75.00,
        "currency": "USD",
        "image_url": "/ui/assets/event3.jpg",
    },
]


class EventsCatalogService:
    def __init__(self):
        self.events = list(EVENTS_DATA)

    def list_events(self, search: Optional[str] = None, category: Optional[str] = None) -> list[dict]:
        results = self.events
        if category:
            cat_lower = category.strip().lower()
            results = [e for e in results if e["category"].lower() == cat_lower]
        if search:
            q = search.strip().lower()
            results = [
                e for e in results
                if q in e["name"].lower()
                or q in e["venue"].lower()
                or q in e["description"].lower()
                or q in e["category"].lower()
                or q in e["event_id"].lower()
            ]
        return results

    def get_event(self, event_id: str) -> Optional[dict]:
        for e in self.events:
            if e["event_id"] == event_id:
                return dict(e)
        return None


events_catalog_service = EventsCatalogService()
