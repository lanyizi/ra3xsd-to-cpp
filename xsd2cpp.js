function GenerateCPlusPlusDeclaration(
  xsdContent,
  extraFieldMapper = undefined,
  extraAlignmentSizeMapper = undefined
) {
  function GetFields(complexType) {
    const fields = [];

    let order = 0;
    const elementNodes = complexType.querySelectorAll("element");
    elementNodes.forEach((element) => {
      const name = element.getAttribute("name");
      const type = element.getAttribute("type");
      const isOptional = element.getAttribute("minOccurs") === "0";
      const isByValue = element.getAttribute("xas:byValue") === "true";
      const maxOccurs = element.getAttribute("maxOccurs") ?? "1";
      const isList = maxOccurs === "unbounded";
      if (!isList && maxOccurs !== "1") {
        throw new Error(`Not implemented: ${type} ${name}`);
      }

      fields.push(new FieldInfo(name, type, false, isOptional && !isByValue, isList, order));
      order++;
    });

    const attributeNodes = complexType.querySelectorAll("attribute");
    attributeNodes.forEach((attribute) => {
      const name = attribute.getAttribute("name");
      const type = attribute.getAttribute("type");
      const isOptional = attribute.getAttribute("use") === "optional";
      const isByValue = attribute.getAttribute("xas:byValue") === "true";

      fields.push(new FieldInfo(name, type, true, isOptional && !isByValue, false, order));
      order++;
    });

    return fields;
  }

  class FieldInfo {
    constructor(name, type, isAttribute, isOptional, isList, order) {
      type = MapFieldType(type);
      if (isList) {
        type = MapFieldType(`SageBinaryDataList<${type}>`);
      } else if (isOptional) {
        type = MapFieldType(`${type}*`);
      }

      this.Name = name;
      this.Type = type;
      this.IsAttribute = isAttribute;
      this.IsOptional = isOptional;
      this.IsList = isList;
      this.AlignmentSize = CalculateAlignmentSize(this.Type);
      this.Order = order;
    }
  }

  function MapFieldType(xsdType) {
    if (extraFieldMapper) {
      const mappedType = extraFieldMapper(xsdType);
      if (mappedType) {
        return mappedType;
      }
    }
    switch (xsdType) {
      case "SageReal":
      case "Percentage":
      case "Angle":
      case "Time":
        return "float";
      case "SageInt":
        return "int";
      case "SageUnsignedInt":
        return "uint";
      case "SageBool":
      case "xs:boolean":
        return "bool";
      case "xs:string":
        return "LengthString";
      default:
        return xsdType;
    }
  }

  function CalculateAlignmentSize(type) {
    if (extraAlignmentSizeMapper) {
      const alignmentSize = extraAlignmentSizeMapper(type);
      if (alignmentSize) {
        return alignmentSize;
      }
    }
    switch (type) {
      case "short":
      case "ushort":
        return 2;
      case "bool":
        return 1;
      default:
        return 4;
    }
  }

  const enums = {};
  const bitFlags = {};

  function dumpEnums() {
    return Object.entries(enums)
      .map(([typeName, enumeration]) => {
        return [
          `enum ${typeName} {`,
          ...enumeration.map((e, i) => `  ${typeName}_${e} = ${i},`),
          "};\n",
        ].join("\n");
      })
      .join("\n");
  }

  function dumpBitFlags() {
    return Object.entries(bitFlags)
      .map(([typeName, enumeration]) => {
        if (enumeration.length < 32) {
          return [
            `enum ${typeName} {`,
            ...enumeration.map((e, i) => `  ${typeName}F_${e} = ${1 << i}u,`),
            "};\n",
          ].join("\n");
        }

        const result = [
          `enum ${typeName}Offsets {`,
          ...enumeration.map(
            (e, i) => `  ${typeName}V${i >> 5}_${e} = ${i % 32},`
          ),
          "};",
        ];
        for (let i = 0; i < enumeration.length; i += 32) {
          result.push(`enum ${typeName}F${i >> 5} {`);
          for (let j = 0; j < Math.min(32, enumeration.length - i); ++j) {
            result.push(
              `  ${typeName}F${i >> 5}_${enumeration[i + j]} = ${
                (1 << j) >>> 0
              }u,`
            );
          }
          result.push("};");
        }
        result.push(`struct ${typeName} {`);
        for (let i = 0; i < enumeration.length; i += 32) {
          result.push(`  ${typeName}F${i >> 5} _${i >> 5};`);
        }
        result.push("};\n");
        return result.join("\n");
      })
      .join("\n");
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(xsdContent, "application/xml");
  // process enums
  const simpleTypes = Array.from(document.querySelectorAll("simpleType"));
  for (const simpleType of simpleTypes) {
    const typeName = simpleType.getAttribute("name");
    const enumeration = Array.from(simpleType.querySelectorAll("enumeration"));
    if (enumeration.length > 0) {
      enums[typeName] = enumeration.map((e) => e.getAttribute("value"));
    }
    const list = simpleType.querySelector("list");
    if (list) {
      const itemType = list.getAttribute("itemType");
      if (Array.isArray(enums[itemType])) {
        bitFlags[typeName] = enums[itemType];
      }
    }
  }
  // process complex types
  const complexTypes = Array.from(document.querySelectorAll("complexType"));
  let hasList = false;
  let hasString = false;
  let hasStringHash = false;
  let hasStringList = false;
  const complexTypeCppDeclarations = complexTypes
    .map((complexType) => {
      const typeName = complexType.getAttribute("name");
      const baseTypeElement = complexType.querySelector("extension");
      const baseTypeName = baseTypeElement
        ? baseTypeElement.getAttribute("base")
        : null;
      const fields = GetFields(complexType).sort((a, b) => {
        if (a.AlignmentSize > b.AlignmentSize) {
          return -1;
        } else if (a.AlignmentSize < b.AlignmentSize) {
          return 1;
        } else {
          if (a.IsAttribute && !b.IsAttribute) {
            return -1;
          } else if (!a.IsAttribute && b.IsAttribute) {
            return 1;
          } else {
            return a.Order - b.Order;
          }
        }
      });
      hasList = hasList || fields.some((f) => f.IsList);
      hasString = hasString || fields.some((f) => f.Type === "LengthString");
      hasStringHash = hasStringHash || fields.some((f) => f.Type === "StringHash");
      hasStringList = hasStringHash || fields.some((f) => f.Type === "StringList");
      return GenerateCPlusPlusStruct(typeName, baseTypeName, fields);
    })
    .join("\n");
  return [
    hasList ? "struct SageBinaryDataList<T> { uint Count; T* Data; };\n" : "",
    hasString ? "struct LengthString { uint Length; char* Text; };\n" : "",
    hasStringHash ? "struct StringHash { uint Hash; };\n" : "",
    hasStringList ? "struct StringList { uint Length; void* Text; };\n" : "",
    dumpEnums(),
    dumpBitFlags(),
    complexTypeCppDeclarations,
  ]
    .filter((x) => !!x.trim())
    .join("\n");
}

function GenerateCPlusPlusStruct(typeName, baseTypeName, fields) {
  let structDeclaration = `struct ${typeName}`;
  if (baseTypeName) {
    structDeclaration += ` : ${baseTypeName}`;
  }
  structDeclaration += " {\n";

  fields.forEach((field) => {
    structDeclaration += `  ${field.Type} ${field.Name};\n`;
  });

  structDeclaration += "};\n";

  return structDeclaration;
}
