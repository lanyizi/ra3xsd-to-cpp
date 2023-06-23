function GenerateCPlusPlusDeclaration(
  xsdContent,
  extraFieldMapper = undefined,
  extraAlignmentSizeMapper = undefined
) {
  const parser = new DOMParser();
  const document = parser.parseFromString(xsdContent, 'application/xml');
  const complexType = document.querySelector('complexType');
  const typeName = complexType.getAttribute('name');
  const baseTypeElement = complexType.querySelector('extension');
  const baseTypeName = baseTypeElement ? baseTypeElement.getAttribute('base') : null;

  function GetFields(complexType) {
    const fields = [];
  
    let order = 0;
    const elementNodes = complexType.querySelectorAll('element');
    elementNodes.forEach((element) => {
      const name = element.getAttribute('name');
      const type = element.getAttribute('type');
      const isOptional = element.getAttribute('minOccurs') === '0';
      const isList = element.getAttribute('maxOccurs') === 'unbounded' || element.getAttribute('maxOccurs') === '1';
  
      fields.push(new FieldInfo(name, type, false, isOptional, isList, order));
      order++;
    });
  
    const attributeNodes = complexType.querySelectorAll('attribute');
    attributeNodes.forEach((attribute) => {
      const name = attribute.getAttribute('name');
      const type = attribute.getAttribute('type');
      const isOptional = attribute.getAttribute('use') === 'optional';
  
      fields.push(new FieldInfo(name, type, true, isOptional, false, order));
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
      case 'SageReal':
      case 'Percentage':
      case 'Angle':
      case 'Time':
        return 'float';
      case 'SageInt':
        return 'int';
      case 'SageUnsignedInt':
        return 'uint';
      case 'SageBool':
        return 'bool';
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
      case 'short':
      case 'ushort':
        return 2;
      case 'bool':
        return 1;
      default:
        return 4;
    }
  }

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

  return GenerateCPlusPlusStruct(typeName, baseTypeName, fields);
}



function GenerateCPlusPlusStruct(typeName, baseTypeName, fields) {
  let structDeclaration = `struct ${typeName}`;
  if (baseTypeName) {
    structDeclaration += ` : ${baseTypeName}`;
  }
  structDeclaration += ' {\n';

  fields.forEach((field) => {
    structDeclaration += `  ${field.Type} ${field.Name};\n`;
  });

  structDeclaration += '}';

  return structDeclaration;
}