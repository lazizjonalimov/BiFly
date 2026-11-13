"""Documents: the upload contract, what may be uploaded, who may see it, links and reviews."""
from tests.conftest import PDF, PNG, act, complete, deliver, new_load, seed, upload


def intent(api, entity_type, entity_id, content=PDF, expect=201, **extra):
    body = {"filename": "scan.pdf", "content_type": "application/pdf", "size_bytes": len(content), "type": "bol",
            "entity_type": entity_type, "entity_id": entity_id, **extra}
    return api.post("/documents/upload-intents", body, expect)


def test_upload_is_intent_then_file_then_complete(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"])
    started = intent(org, "load", load["id"]).json()
    doc_id = started["document"]["id"]
    assert started["upload"] == {"method": "PUT", "url": f"/documents/{doc_id}/content",
                                 "headers": {"Content-Type": "application/pdf"}}
    assert started["document"]["upload_status"] == "pending"

    # Until it is completed the document does not exist as far as anyone else is concerned.
    assert org.items("/documents") == []
    org.error("GET", f"/documents/{doc_id}", 404, "NOT_FOUND")
    org.error("GET", f"/documents/{doc_id}/download", 404, "NOT_FOUND")
    org.error("POST", f"/documents/{doc_id}/complete", 409, "UPLOAD_INCOMPLETE")

    org.put(started["upload"]["url"], content=PDF, headers=started["upload"]["headers"], expect=204)
    done = org.post(f"/documents/{doc_id}/complete", expect=200).json()
    assert done["upload_status"] == "uploaded" and done["size_bytes"] == len(PDF) and done["review_status"] == "not_required"
    assert done["links"] == [{"id": done["links"][0]["id"], "entity_type": "load", "entity_id": load["id"],
                              "label": load["load_number"]}]
    assert done["uploaded_by_name"] == "Olive Owner"

    r = org.get(f"/documents/{doc_id}/download")
    assert r.content == PDF and r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"] == "attachment; filename*=UTF-8''scan.pdf"
    assert r.headers["x-content-type-options"] == "nosniff" and "no-store" in r.headers["cache-control"]
    assert org.get(f"/documents/{doc_id}/download", params={"disposition": "inline"}).headers["content-disposition"].startswith("inline")
    org.error("POST", f"/documents/{doc_id}/complete", 409, "STATE_CONFLICT")       # completing twice changes nothing
    assert [e["action"] for e in org.items("/audit-logs", entity_type="document", entity_id=doc_id)] == [
        "document.downloaded", "document.downloaded", "document.uploaded"]


def test_only_announced_safe_files_are_accepted(org):
    s = seed(org)
    c = s["customer"]["id"]
    assert intent(org, "customer", c, content_type="application/x-msdownload", expect=422).json()["error"]["field_errors"].keys() == {"content_type"}
    assert intent(org, "customer", c, content_type="text/html", expect=422).json()["error"]["code"] == "VALIDATION_ERROR"
    assert intent(org, "customer", c, size_bytes=16 * 1024 * 1024, expect=422).json()["error"]["field_errors"].keys() == {"size_bytes"}
    intent(org, "customer", c, type="selfie", expect=422)
    intent(org, "expense", c, expect=422)

    # The bytes must be the size that was announced...
    started = intent(org, "customer", c).json()
    org.error("PUT", started["upload"]["url"], 413, "PAYLOAD_TOO_LARGE", content=PDF + b"extra")
    # ...and really be the kind of file that was announced: a renamed script is discarded, not stored.
    script = b"<script>alert(1)</script>".ljust(len(PDF), b" ")
    started = intent(org, "customer", c, content=script).json()
    org.put(started["upload"]["url"], content=script, expect=204)
    assert org.error("POST", f"/documents/{started['document']['id']}/complete", 422, "VALIDATION_ERROR")["field_errors"].keys() == {"file"}
    assert org.items("/documents") == []
    org.error("POST", f"/documents/{started['document']['id']}/complete", 404, "NOT_FOUND")

    image = upload(org, "customer", c, "other", content=PNG, filename="dock photo.png", content_type="image/png")
    assert org.get(f"/documents/{image['id']}/download").headers["content-disposition"] == "attachment; filename*=UTF-8''dock%20photo.png"


def test_an_oversized_request_is_cut_off_before_it_is_read(org, client):
    r = client.put("/api/v1/documents/00000000-0000-0000-0000-000000000000/content", content=b"x" * (16 * 1024 * 1024),
                   headers=org.h)
    assert r.status_code == 413 and r.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_someone_elses_pending_upload_cannot_be_filled_in(org):
    s = seed(org)
    started = intent(org, "customer", s["customer"]["id"]).json()
    other = org.add_user("dispatcher")
    other.error("PUT", started["upload"]["url"], 404, "NOT_FOUND", content=PDF)
    other.error("POST", f"/documents/{started['document']['id']}/complete", 404, "NOT_FOUND")


def test_listing_filtering_and_linking(org):
    s = seed(org)
    load = new_load(org, s["customer"]["id"])
    bol = upload(org, "load", load["id"], "bol", filename="bol-778.pdf")
    upload(org, "vehicle", s["truck"]["id"], "insurance", filename="policy.pdf", expires_on="2020-01-01")
    upload(org, "customer", s["customer"]["id"], "rate_confirmation", filename="ratecon.pdf")

    assert {d["filename"] for d in org.items("/documents")} == {"bol-778.pdf", "policy.pdf", "ratecon.pdf"}
    assert [d["filename"] for d in org.items("/documents", entity_type="load", entity_id=load["id"])] == ["bol-778.pdf"]
    assert [d["filename"] for d in org.items("/documents", type="insurance")] == ["policy.pdf"]
    assert [d["filename"] for d in org.items("/documents", expiring="true")] == ["policy.pdf"]
    assert [d["filename"] for d in org.items("/documents", q="ratecon")] == ["ratecon.pdf"]
    assert [d["filename"] for d in org.items("/documents", review_status="pending")] == ["policy.pdf"]

    # One file, several records: link it instead of uploading it again.
    linked = org.post(f"/documents/{bol['id']}/links", {"entity_type": "customer", "entity_id": s["customer"]["id"]}, 201).json()
    assert {x["label"] for x in linked["links"]} == {load["load_number"], "Globex"}
    assert len(org.post(f"/documents/{bol['id']}/links", {"entity_type": "customer", "entity_id": s["customer"]["id"]}, 201).json()["links"]) == 2
    assert len(org.items("/documents", entity_type="customer", entity_id=s["customer"]["id"])) == 2
    load_link = next(x for x in linked["links"] if x["entity_type"] == "load")
    org.delete(f"/documents/{bol['id']}/links/{load_link['id']}", expect=204)
    remaining = org.get(f"/documents/{bol['id']}").json()["links"]
    org.error("DELETE", f"/documents/{bol['id']}/links/{remaining[0]['id']}", 409, "STATE_CONFLICT")   # never orphaned

    renamed = org.patch(f"/documents/{bol['id']}", {"filename": "BOL 778 signed.pdf", "expires_on": "2030-01-01"}, 200).json()
    assert renamed["filename"] == "BOL 778 signed.pdf" and renamed["expires_on"] == "2030-01-01"
    org.delete(f"/documents/{bol['id']}", expect=204)
    org.error("GET", f"/documents/{bol['id']}/download", 404, "NOT_FOUND")


def test_licence_and_medical_scans_follow_the_same_rule_as_the_numbers_on_them(org):
    s = seed(org)
    licence = upload(org, "driver", s["driver"]["id"], "license", filename="cdl.pdf", expires_on="2035-01-01")
    dispatcher, safety = org.add_user("dispatcher"), org.add_user("safety_manager")
    assert dispatcher.items("/documents", entity_type="driver", entity_id=s["driver"]["id"]) == []
    dispatcher.error("GET", f"/documents/{licence['id']}", 404, "NOT_FOUND")
    dispatcher.error("GET", f"/documents/{licence['id']}/download", 404, "NOT_FOUND")
    assert intent(dispatcher, "driver", s["driver"]["id"], type="medical", expect=403).json()["error"]["code"] == "FORBIDDEN"
    assert safety.get(f"/documents/{licence['id']}/download").content == PDF

    # A role that can't see a kind of record can't attach to it either.
    assert intent(safety, "customer", s["customer"]["id"], expect=403).json()["error"]["code"] == "FORBIDDEN"
    org.add_user("viewer").error("POST", "/documents/upload-intents", 403, "FORBIDDEN", json={})
    dispatcher.error("DELETE", f"/documents/{licence['id']}", 403, "FORBIDDEN")


def test_compliance_documents_are_reviewed_by_safety(org):
    s = seed(org)
    card = upload(org, "driver", s["driver"]["id"], "medical", filename="med-card.pdf")
    assert card["review_status"] == "pending"
    safety = org.add_user("safety_manager")
    assert safety.error("POST", f"/documents/{card['id']}/review", 422, "VALIDATION_ERROR",
                        json={"decision": "rejected"})["field_errors"].keys() == {"note"}
    rejected = safety.post(f"/documents/{card['id']}/review", {"decision": "rejected", "note": "Page 2 is missing"}, 200).json()
    assert rejected["review_status"] == "rejected" and rejected["reviewed_by_name"] == "Safety Manager"
    assert safety.post(f"/documents/{card['id']}/review", {"decision": "approved"}, 200).json()["review_note"] is None
    org.add_user("accountant").error("POST", f"/documents/{card['id']}/review", 403, "FORBIDDEN", json={"decision": "approved"})

    receipt = upload(org, "vehicle", s["truck"]["id"], "receipt")
    safety.error("POST", f"/documents/{receipt['id']}/review", 409, "STATE_CONFLICT", json={"decision": "approved"})
    load = deliver(org, new_load(org, s["customer"]["id"]), s)
    pod = upload(org, "load", load["id"])
    safety.error("POST", f"/documents/{pod['id']}/review", 409, "STATE_CONFLICT", json={"decision": "approved"})


def test_the_proof_behind_a_completed_load_cannot_be_removed(org):
    s = seed(org)
    load = complete(org, s)
    pod = org.items("/documents", entity_type="load", entity_id=load["id"])[0]
    org.error("DELETE", f"/documents/{pod['id']}", 409, "STATE_CONFLICT")
    assert org.get(f"/documents/{pod['id']}/download").content == PDF


def test_a_driver_can_add_paperwork_only_to_their_own_load(org):
    s = seed(org, with_login=True)
    driver = s["driver_api"]
    load = new_load(org, s["customer"]["id"])
    assert intent(driver, "load", load["id"], type="pod", expect=403).json()["error"]["code"] == "FORBIDDEN"   # not theirs yet
    load = deliver(org, load, s)
    assert intent(driver, "load", load["id"], type="rate_confirmation", expect=403).json()["error"]["code"] == "FORBIDDEN"
    assert intent(driver, "customer", s["customer"]["id"], expect=403).json()["error"]["code"] == "FORBIDDEN"
    upload(driver, "load", load["id"], "pod", filename="signed-pod.pdf")
    reviewed = org.get(f"/loads/{load['id']}").json()
    assert reviewed["status"] == "pod_review" and reviewed["events"][-1]["action"] == "pod_uploaded"
    assert driver.get(f"/driver/loads/{load['id']}").json()["needs_pod"] is False
    driver.error("GET", "/documents", 403, "FORBIDDEN")
    assert act(org, reviewed, "approve_pod")["status"] == "completed"
