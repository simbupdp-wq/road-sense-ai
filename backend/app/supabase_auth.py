"""Supabase Auth and RLS-protected profile access for the FastAPI service."""

from __future__ import annotations

import os
from typing import Any

import httpx


class SupabaseAuthError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


def _settings() -> tuple[str, str]:
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    publishable_key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
    if not url or not publishable_key:
        raise SupabaseAuthError(
            503,
            "Supabase is not configured. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the backend environment.",
        )
    return url, publishable_key


def _request(
    method: str,
    path: str,
    *,
    access_token: str | None = None,
    json_body: dict[str, Any] | None = None,
    params: dict[str, str] | None = None,
) -> Any:
    url, publishable_key = _settings()
    headers = {"apikey": publishable_key, "Accept": "application/json"}
    if json_body is not None:
        headers["Content-Type"] = "application/json"
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    try:
        response = httpx.request(
            method,
            f"{url}{path}",
            headers=headers,
            json=json_body,
            params=params,
            timeout=20.0,
        )
    except httpx.RequestError as exc:
        raise SupabaseAuthError(503, "Could not connect to Supabase. Check the project URL and network.") from exc

    if response.status_code >= 400:
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        message = (
            payload.get("msg")
            or payload.get("message")
            or payload.get("error_description")
            or payload.get("error")
            or "Supabase rejected the request."
        )
        raise SupabaseAuthError(response.status_code, str(message))
    if not response.content:
        return None
    try:
        return response.json()
    except ValueError as exc:
        raise SupabaseAuthError(502, "Supabase returned an unreadable response.") from exc


def _profile(access_token: str, user_id: str) -> dict:
    records = _request(
        "GET",
        "/rest/v1/profiles",
        access_token=access_token,
        params={
            "select": "id,display_name,email,role",
            "id": f"eq.{user_id}",
            "limit": "1",
        },
    )
    if not isinstance(records, list) or not records:
        raise SupabaseAuthError(
            403,
            "Your profile is missing or unavailable. Ask the project administrator to check the profiles table and its signup trigger.",
        )
    profile = records[0]
    if profile.get("id") != user_id or profile.get("role") not in {"public", "authority"}:
        raise SupabaseAuthError(403, "Your profile role is invalid. Contact the project administrator.")
    return {
        "user_id": profile["id"],
        "name": profile.get("display_name") or "RoadSense user",
        "email": profile.get("email", ""),
        "role": profile["role"],
    }


def sign_up(email: str, password: str, display_name: str) -> dict:
    payload = _request(
        "POST",
        "/auth/v1/signup",
        json_body={
            "email": email.strip(),
            "password": password,
            "data": {"display_name": display_name.strip()},
        },
    )
    access_token = payload.get("access_token") if isinstance(payload, dict) else None
    user_data = payload.get("user") if isinstance(payload, dict) else None
    if not access_token or not isinstance(user_data, dict) or not user_data.get("id"):
        return {
            "requires_email_confirmation": True,
            "message": "Account created. Confirm the email address, then sign in.",
        }
    return {
        "access_token": access_token,
        "refresh_token": payload.get("refresh_token"),
        "expires_in": payload.get("expires_in"),
        "user": _profile(access_token, user_data["id"]),
    }


def sign_in(email: str, password: str, expected_role: str) -> dict:
    payload = _request(
        "POST",
        "/auth/v1/token",
        params={"grant_type": "password"},
        json_body={"email": email.strip(), "password": password},
    )
    if not isinstance(payload, dict) or not payload.get("access_token"):
        raise SupabaseAuthError(401, "Email or password is incorrect.")
    user_data = payload.get("user") or {}
    user_id = user_data.get("id")
    if not user_id:
        raise SupabaseAuthError(401, "Supabase did not return a valid signed-in user.")
    user = _profile(payload["access_token"], user_id)
    if user["role"] != expected_role:
        raise SupabaseAuthError(403, "This account is not registered for the selected sign-in area.")
    return {
        "access_token": payload["access_token"],
        "refresh_token": payload.get("refresh_token"),
        "expires_in": payload.get("expires_in"),
        "user": user,
    }


def refresh_session(refresh_token: str) -> dict:
    payload = _request(
        "POST",
        "/auth/v1/token",
        params={"grant_type": "refresh_token"},
        json_body={"refresh_token": refresh_token},
    )
    if not isinstance(payload, dict) or not payload.get("access_token"):
        raise SupabaseAuthError(401, "Your session expired. Please sign in again.")
    user_data = payload.get("user") or {}
    user_id = user_data.get("id")
    if not user_id:
        raise SupabaseAuthError(401, "Supabase could not restore this session.")
    return {
        "access_token": payload["access_token"],
        "refresh_token": payload.get("refresh_token"),
        "expires_in": payload.get("expires_in"),
        "user": _profile(payload["access_token"], user_id),
    }


def get_user(access_token: str) -> dict:
    user_data = _request("GET", "/auth/v1/user", access_token=access_token)
    user_id = user_data.get("id") if isinstance(user_data, dict) else None
    if not user_id:
        raise SupabaseAuthError(401, "Your session expired. Please sign in again.")
    return _profile(access_token, user_id)


def sign_out(access_token: str) -> None:
    _request(
        "POST",
        "/auth/v1/logout",
        access_token=access_token,
        params={"scope": "local"},
    )


def save_event_review(
    analysis_id: str,
    event: dict,
    camera_location: dict,
    access_token: str,
) -> None:
    """Persist a reviewed event using the authority user's RLS-scoped session."""
    _request(
        "POST",
        "/rest/v1/road_safety_events",
        access_token=access_token,
        json_body={
            "analysis_id": analysis_id,
            "event_id": event["event_id"],
            "camera_id": camera_location.get("camera_id"),
            "location_name": camera_location["location_name"],
            "latitude": camera_location["latitude"],
            "longitude": camera_location["longitude"],
            "location_source": camera_location.get("source", "demo"),
            "risk": event.get("risk"),
            "object_classes": event.get("classes", []),
            "object_ids": event.get("object_ids", []),
            "start_frame": event.get("start_frame"),
            "peak_frame": event.get("peak_frame"),
            "end_frame": event.get("end_frame"),
            "minimum_distance_pixels": event.get("minimum_distance_pixels"),
            "review_status": event["review_status"],
            "review_note": event.get("review_note", ""),
        },
    )


def list_confirmed_event_locations() -> list[dict]:
    """Read rows allowed by the public confirmed-events RLS policy."""
    rows = _request(
        "GET",
        "/rest/v1/road_safety_events",
        params={
            "select": "camera_id,location_name,latitude,longitude,location_source",
            "review_status": "eq.confirmed",
        },
    )
    if not isinstance(rows, list):
        raise SupabaseAuthError(502, "Supabase returned an invalid hotspot list.")
    return rows
