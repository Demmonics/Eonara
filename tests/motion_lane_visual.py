"""Matched priority-style frames/font audition. Headless only, never sends desktop input."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
from visual_fixtures import make_contact_sheet, capture_case, build_fixture_url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",required=True)
    parser.add_argument("--out",required=True,type=Path)
    args=parser.parse_args()
    assert urlsplit(args.url).hostname == "127.0.0.1"
    args.out.mkdir(parents=True,exist_ok=False)
    (args.out/"frames").mkdir()
    records, sheets, errors = [], [], []
    with sync_playwright() as p:
        browser=p.chromium.launch(channel="msedge",headless=True,args=["--no-proxy-server","--disable-background-networking"])
        ctx=browser.new_context(viewport={"width":1182,"height":741},device_scale_factor=1,service_workers="block")
        host=urlsplit(args.url).netloc
        ctx.route("**/*",lambda r:r.continue_() if urlsplit(r.request.url).netloc==host else r.abort())
        page=ctx.new_page()
        page.on("pageerror",lambda e:errors.append(str(e)))
        page.on("console",lambda m:errors.append(m.text) if m.type=="error" else None)
        page.goto(build_fixture_url(args.url),wait_until="networkidle")
        page.evaluate("document.fonts.ready")
        # Identical text/viewport/ink palette/phase. Native vendor timing and text differ;
        # these are internal A/B frames, not a numeric claim of reference parity.
        for style in ["ship","fisheye","message-thread"]:
            frames=[]
            for ms in [250,750,1000,1550,1950,2900,3850,4450,5600]:
                fid=f"frames/{style}-{ms}"
                record=capture_case(page,host,args.out,fid,ms,{
                    "styleId":style,"fixtureId":"suite","stageOnly":True,"dpr":1,
                    "font":"Inter Variable","weight":600,"reducedMotion":False,
                    "palette":{"primary":"#225277","secondary":"#67748a","accent":"#f4f5f9"},
                    "bgTimeMs":1200})
                records.append(record);frames.append((f"{style} {ms}ms",args.out/record["image"]))
            make_contact_sheet(frames,args.out/f"contact-{style}.png",cols=3,tile_w=450)
        for font in ["Inter Variable","Segoe UI Variable","Arial"]:
            for dial in [600,700,800]:
                fid=f"frames/font-{font.replace(' ','-')}-{dial}"
                record=capture_case(page,host,args.out,fid,1550,{
                    "styleId":"ship","fixtureId":"suite","font":font,"weight":dial,"dpr":1,"stageOnly":True})
                records.append(record)
                sheets.append((f"{font}, dial {dial}",args.out/record["image"]))
        make_contact_sheet(sheets,args.out/"contact-fonts.png",cols=3,tile_w=450)
        assert not errors,errors
        browser.close()
    (args.out/"results.json").write_text(json.dumps({"frames":records,"errors":errors,
      "scope":"headless Edge, 1182x741 @ DPR1; font names are requested families, not proof of OS-resolved font identity"},indent=2),encoding="utf8")
    print(f"PASS: {len(records)} priority/font frames")


if __name__=="__main__":
    main()
