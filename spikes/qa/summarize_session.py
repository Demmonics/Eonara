"""Summarize completed labelled repetitions; never treats capture cadence as FPS."""
import argparse
import json
from pathlib import Path
import statistics
import re


def median(values):
    return statistics.median(values) if values else None


def gpu_summary(path):
    if not path.exists():
        return {"available":False}
    data=json.loads(path.read_text(encoding="utf-8-sig"))
    samples=[]
    # GPU collector starts alongside the CPU collector's five-second warmup.
    # Drop first five 1 Hz counter observations; timestamps remain in raw evidence.
    for row in data["rows"][5:]:
        engines={}
        dedicated=shared=0
        for counter in row["values"]:
            if counter["status"] != 0:
                continue
            instance=counter["instance"]
            kind=counter["counter"].lower()
            if kind=="utilization percentage" and "engtype_3d" in instance.lower():
                key=re.sub(r"^pid_\d+_","",instance)
                engines[key]=engines.get(key,0)+counter["value"]
            elif kind=="dedicated usage":
                dedicated+=counter["value"]
            elif kind=="shared usage":
                shared+=counter["value"]
        samples.append({"max_3d_engine_percent":max(engines.values(),default=0),
                        "dedicated_mib":dedicated/2**20,"shared_mib":shared/2**20})
    return {"available":bool(samples),"samples":len(samples),
            **{key:median([r[key] for r in samples]) for key in
               ("max_3d_engine_percent","dedicated_mib","shared_mib")}}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--session",type=Path,required=True)
    p.add_argument("--out",type=Path,required=True)
    args=p.parse_args()
    scenarios=[]
    for folder in sorted(args.session.glob("bench-*")):
        files=sorted(folder.glob("cpu-*.json"))
        if not files:
            continue
        rows=[]
        for path in files:
            data=json.loads(path.read_text(encoding="utf8"))
            s=data["summary"]
            rep=path.stem.split("-")[-1]
            rows.append({"rep":int(rep),"cpu_machine":s["time_weighted_cpu_percent_machine"],
                         "cpu_one_core":s["time_weighted_cpu_percent_one_core"],
                         "cpu_p95_one_core":s["cpu_percent_one_core"]["p95"],
                         "working_set_mib":s["tree_working_set_mib"]["median"],
                         "private_mib":s["tree_private_mib"]["median"],
                         "host_working_set_mib":s["host_working_set_mib"]["median"],
                         "host_private_mib":s["host_private_mib"]["median"],
                         "unavailable_pids":s["unavailable_pids_observed"],
                         "gpu":gpu_summary(folder/f"gpu-{rep}.json")})
        scenarios.append({"directory":folder.name,"scenario":data["scenario"],"repetitions":rows,
                          "median":{key:median([r[key] for r in rows]) for key in
                                    ("cpu_machine","cpu_one_core","working_set_mib","private_mib",
                                     "host_working_set_mib","host_private_mib")}})
    args.out.write_text(json.dumps(scenarios,indent=2),encoding="utf8")
    print(json.dumps([{"scenario":s["directory"],**s["median"]} for s in scenarios],indent=2))


if __name__=="__main__":
    main()
