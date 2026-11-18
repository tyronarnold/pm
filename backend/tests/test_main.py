import re

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_index_serves_kanban_app():
    response = client.get("/")
    assert response.status_code == 200
    assert "Kanban Studio" in response.text


def test_static_assets_are_served():
    html = client.get("/").text
    assets = re.findall(r'(/_next/static/[^"]+\.(?:js|css))', html)
    assert assets
    for asset in assets:
        assert client.get(asset).status_code == 200
