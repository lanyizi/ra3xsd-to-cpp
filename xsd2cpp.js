function generateCPlusPlusDeclaration(
  xsdContent,
  extraFieldMapper = undefined,
  extraAlignmentSizeMapper = undefined
) {
  function trySpecialHandling(complexTypeName, memberName, typeName, order) {
    const mapper = {
      GameObject: {
        UpgradeCameo: FieldInfo.newList(memberName, typeName, order),
        DisplayUpgrade: FieldInfo.newList(memberName, typeName, order),
      }
    }
    const mapByType = mapper[complexTypeName];
    if (!mapByType) {
      return null;
    }
    return mapByType[memberName] ?? null;
  }
  
  function getFields(complexType) {
    const complexTypeName = complexType.getAttribute("name");
    const fields = [];

    const elementNodes = Array.from(complexType.querySelectorAll("element")).filter(
      (element) => element.closest("complexType") === complexType
    );
    const attributeNodes = Array.from(
      complexType.querySelectorAll("attribute")
    ).filter((attribute) => attribute.closest("complexType") === complexType);

    let order = 0;
    elementNodes.forEach((element) => {
      const name = element.getAttribute("name");
      let type = element.getAttribute("type");
      if (!type) {
        const inlineComplexTypes = Array.from(element.children).filter(
          (child) => child.localName === "complexType"
        );
        if (inlineComplexTypes.length > 1) {
          throw new Error(
            `Not implemented: ${complexTypeName} ${name}, multiple inline complexType definitions`
          );
        }
        if (inlineComplexTypes.length === 1) {
          type = inlineComplexTypes[0].getAttribute("name");
        }
      }
      if (!type) {
        throw new Error(
          `Not implemented: ${complexTypeName} ${name}, missing element type declaration`
        );
      }
      const speciallyHandled = trySpecialHandling(complexTypeName, name, type, order);
      if (speciallyHandled) {
        fields.push(speciallyHandled);
        order++;
        return;
      }
      const isOptional = element.getAttribute("minOccurs") === "0";
      const isByValue = element.getAttribute("xas:byValue") === "true";
      const maxOccurs = element.getAttribute("maxOccurs") ?? "1";
      const isList = maxOccurs === "unbounded";
      if (!isList && maxOccurs !== "1") {
        throw new Error(`Not implemented: ${complexTypeName} ${type} ${name}, maxOccurs = ${maxOccurs}`);
      }
      fields.push(new FieldInfo(name, type, false, isOptional && !isByValue, isList, order));
      order++;
    });

    attributeNodes.forEach((attribute) => {
      const name = attribute.getAttribute("name");
      const type = attribute.getAttribute("type");
      const speciallyHandled = trySpecialHandling(complexTypeName, name, type, order);
      if (speciallyHandled) {
        fields.push(speciallyHandled);
        order++;
        return;
      }
      const isOptional = attribute.getAttribute("use") === "optional";
      const isByValue = attribute.getAttribute("xas:byValue") === "true";

      fields.push(new FieldInfo(name, type, true, isOptional && !isByValue, false, order));
      order++;
    });

    return fields;
  }

  class FieldInfo {
    constructor(name, type, isAttribute, isOptional, isList, order) {
      type = mapFieldType(type);
      if (isList) {
        type = mapFieldType(`SageBinaryDataList<${type}>`);
      } else if (isOptional) {
        type = mapFieldType(`${type}*`);
      }

      this.Name = name;
      this.Type = type;
      this.IsAttribute = isAttribute;
      this.IsOptional = isOptional;
      this.IsList = isList;
      this.AlignmentSize = calculateAlignmentSize(this.Type);
      this.Order = order;
    }
    static newList(name, type, order) {
      return new FieldInfo(name, type, false, false, true, order);
    }
    static newPointerElement(name, type, order) {
      return new FieldInfo(name, type, false, true, false, order);
    }
    static newValueElement(name, type, order) {
      return new FieldInfo(name, type, false, false, false, order);
    }
    static newPointerAttribute(name, type, order) {
      return new FieldInfo(name, type, true, true, false, order);
    }
    static newValueAttribute(name, type, order) {
      return new FieldInfo(name, type, true, false, false, order);
    }
  }

  function mapFieldType(xsdType) {
    if (extraFieldMapper) {
      const mappedType = extraFieldMapper(xsdType);
      if (mappedType) {
        return mappedType;
      }
    }
    switch (xsdType) {
      case "xs:float":
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
      case "AssetId":
        return "LengthString";
      default:
        return xsdType;
    }
  }

  function calculateAlignmentSize(type) {
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
  const existingTypeNames = new Set(
    Array.from(document.querySelectorAll("complexType"))
      .map((complexType) => complexType.getAttribute("name"))
      .filter((typeName) => !!typeName)
  );
  const anonymousComplexTypes = Array.from(
    document.querySelectorAll("complexType")
  ).filter((complexType) => !complexType.getAttribute("name"));
  anonymousComplexTypes.forEach((complexType) => {
    const owningElement = complexType.parentElement;
    if (!owningElement || owningElement.localName !== "element") {
      throw new Error(
        "Not implemented: anonymous complexType outside direct xs:element declaration"
      );
    }

    const elementName = owningElement.getAttribute("name");
    if (!elementName) {
      throw new Error(
        "Not implemented: anonymous complexType inside xs:element without name"
      );
    }

    const owningNamedComplexType = owningElement.closest("complexType");
    const owningComplexTypeName = owningNamedComplexType?.getAttribute("name");
    if (!owningComplexTypeName) {
      throw new Error(
        `Not implemented: anonymous complexType for element ${elementName} is not nested inside a named complexType`
      );
    }

    let generatedTypeName = `${owningComplexTypeName}_${elementName}`;
    if (existingTypeNames.has(generatedTypeName)) {
      let disambiguationIndex = 2;
      while (existingTypeNames.has(`${generatedTypeName}_${disambiguationIndex}`)) {
        disambiguationIndex++;
      }
      generatedTypeName = `${generatedTypeName}_${disambiguationIndex}`;
    }
    existingTypeNames.add(generatedTypeName);
    complexType.setAttribute("name", generatedTypeName);

    const existingElementType = owningElement.getAttribute("type");
    if (existingElementType && existingElementType !== generatedTypeName) {
      throw new Error(
        `Not implemented: element ${elementName} has both explicit type ${existingElementType} and anonymous complexType`
      );
    }
    owningElement.setAttribute("type", generatedTypeName);
  });
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
      const fields = getFields(complexType).sort((a, b) => {
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
      return generateCPlusPlusStruct(typeName, baseTypeName, fields);
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

function generateCPlusPlusStruct(typeName, baseTypeName, fields) {
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
