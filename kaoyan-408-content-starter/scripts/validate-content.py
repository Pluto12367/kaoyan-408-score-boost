from pathlib import Path
import json
import sys
from typing import Any

import yaml
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parent.parent


def load_yaml(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def validate_file(data: dict, schema: dict, path: Path) -> list[str]:
    validator = Draft202012Validator(schema)
    errors = []
    for error in sorted(validator.iter_errors(data), key=lambda e: list(e.path)):
        location = ".".join(str(item) for item in error.path) or "<root>"
        errors.append(f"{path}: {location}: {error.message}")
    return errors


def collect_ids(pattern: str) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for path in ROOT.glob(pattern):
        data = load_yaml(path)
        if isinstance(data, dict) and data.get("id"):
            result[data["id"]] = path
    return result


def main() -> int:
    errors: list[str] = []

    source_schema = load_json(ROOT / "schemas" / "source.schema.json")
    knowledge_schema = load_json(ROOT / "schemas" / "knowledge-point.schema.json")
    question_schema = load_json(ROOT / "schemas" / "question.schema.json")

    source_file = ROOT / "sources" / "source-registry.yaml"
    source_data = load_yaml(source_file)
    errors.extend(validate_file(source_data, source_schema, source_file))

    source_ids = {
        source["id"]
        for source in source_data.get("sources", [])
        if isinstance(source, dict) and source.get("id")
    }

    knowledge_ids = collect_ids("taxonomy/knowledge-points/**/*.yaml")
    question_ids = collect_ids("questions/**/*.yaml")

    for path in ROOT.glob("taxonomy/knowledge-points/**/*.yaml"):
        data = load_yaml(path)
        errors.extend(validate_file(data, knowledge_schema, path))
        for source_id in data.get("source_ids", []):
            if source_id not in source_ids:
                errors.append(f"{path}: 不存在的来源ID：{source_id}")
        for kp_id in data.get("prerequisites", []):
            if kp_id not in knowledge_ids:
                errors.append(f"{path}: 不存在的前置知识点ID：{kp_id}")

    for path in ROOT.glob("questions/**/*.yaml"):
        data = load_yaml(path)
        errors.extend(validate_file(data, question_schema, path))

        for kp_id in data.get("knowledge_point_ids", []):
            if kp_id not in knowledge_ids:
                errors.append(f"{path}: 不存在的知识点ID：{kp_id}")

        for kp_id in data.get("prerequisite_ids", []):
            if kp_id not in knowledge_ids:
                errors.append(f"{path}: 不存在的前置知识点ID：{kp_id}")

        for source_id in data.get("source", {}).get("source_ids", []):
            if source_id not in source_ids:
                errors.append(f"{path}: 不存在的来源ID：{source_id}")

        if data.get("question_type") == "single_choice":
            options = data.get("options", {})
            answer = data.get("answer", {}).get("value")
            if answer not in options:
                errors.append(f"{path}: 正确答案 {answer!r} 不在选项中")

        if data.get("copyright_status") == "PROHIBITED":
            errors.append(f"{path}: 版权状态为PROHIBITED，不允许进入题库")

    # 检查知识点关系中的引用
    relation_file = ROOT / "taxonomy" / "knowledge-relations.yaml"
    relation_data = load_yaml(relation_file)
    for index, relation in enumerate(relation_data.get("relations", []), start=1):
        if relation.get("from") not in knowledge_ids:
            errors.append(f"{relation_file}: 第{index}条关系的from不存在：{relation.get('from')}")
        if relation.get("to") not in knowledge_ids:
            errors.append(f"{relation_file}: 第{index}条关系的to不存在：{relation.get('to')}")

    # 检查测评引用
    for path in ROOT.glob("assessments/**/*.yaml"):
        data = load_yaml(path)
        for kp_id in data.get("knowledge_point_ids", []):
            if kp_id not in knowledge_ids:
                errors.append(f"{path}: 不存在的知识点ID：{kp_id}")
        for question_id in data.get("question_ids", []):
            if question_id not in question_ids:
                errors.append(f"{path}: 不存在的题目ID：{question_id}")

    if errors:
        print("内容校验失败：")
        for error in errors:
            print(f"  - {error}")
        return 1

    print("内容校验通过。")
    print(f"来源数量：{len(source_ids)}")
    print(f"知识点数量：{len(knowledge_ids)}")
    print(f"题目数量：{len(question_ids)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
