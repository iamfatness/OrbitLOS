param(
  [Parameter(Mandatory)] [string] $SourceDirectory,
  [Parameter(Mandatory)] [string] $FieldInventory
)

$ErrorActionPreference = 'Stop'
$schemaArchive = Join-Path $SourceDirectory 'MCRUploadSchemaV7.zip'
$sampleArchive = Join-Path $SourceDirectory 'MCR_FV7_XML_Sample_Pack.zip'
$schemaName = 'MCRBatchFileSchemaV7.xsd'
$pins = @{
  $schemaArchive = '56A221183FAAE7E04557A88F00DB124061CD24E059C0FB6717872DAE7769EB5F'
  $sampleArchive = '31A2A808F058CA291F6A42C0ACD762908E226BC741F8312BDDFC46588865C1BD'
}
foreach ($path in $pins.Keys) {
  if ((Get-FileHash -LiteralPath $path).Hash -ne $pins[$path]) {
    throw "Source checksum differs for $(Split-Path -Leaf $path). Review the new version before using it."
  }
}

function Open-SourceReader($archive, [string] $entryName, $settings) {
  $entry = $archive.GetEntry($entryName)
  if (!$entry) { throw "The pinned archive is missing $entryName." }
  return [System.Xml.XmlReader]::Create($entry.Open(), $settings)
}

$settings = [System.Xml.XmlReaderSettings]::new()
$settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
$settings.XmlResolver = $null
$settings.CloseInput = $true
$schemaZip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $schemaArchive).Path)
try {
  $sampleZip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $sampleArchive).Path)
  try {
    foreach ($zip in @($schemaZip, $sampleZip)) {
      $stream = $zip.GetEntry($schemaName).Open()
      try { $hash = (Get-FileHash -InputStream $stream).Hash } finally { $stream.Dispose() }
      if ($hash -ne '905FACFF69980BFB0D1862935C0883162599BC77011E1CB438222812B575C97F') {
        throw 'The schema archives disagree with the pinned XSD.'
      }
    }

    $schemaReader = Open-SourceReader $schemaZip $schemaName $settings
    try {
      $schemas = [System.Xml.Schema.XmlSchemaSet]::new()
      $schemas.XmlResolver = $null
      $null = $schemas.Add($null, $schemaReader)
      $schemas.Compile()
    } finally { $schemaReader.Dispose() }
    $validation = $settings.Clone()
    $validation.Schemas = $schemas
    $validation.ValidationType = [System.Xml.ValidationType]::Schema
    foreach ($name in @('MCRv7AllFieldsSample.xml', 'MCRv7Annual.xml')) {
      $sample = Open-SourceReader $sampleZip $name $validation
      try { while ($sample.Read()) {} } finally { $sample.Dispose() }
      Write-Output "XSD valid: $name"
    }

    $schemaReader = Open-SourceReader $schemaZip $schemaName $settings
    try {
      $document = [System.Xml.XmlDocument]::new()
      $document.XmlResolver = $null
      $document.Load($schemaReader)
    } finally { $schemaReader.Dispose() }
    $namespace = [System.Xml.XmlNamespaceManager]::new($document.NameTable)
    $namespace.AddNamespace('xs', 'http://www.w3.org/2001/XMLSchema')
    $leaves = $document.SelectNodes('//xs:element[@name and not(xs:complexType)] | //xs:attribute[@name]', $namespace)
    $inventory = foreach ($leaf in $leaves) {
      $parents = @($leaf.SelectNodes('ancestor::xs:element[@name]', $namespace) | ForEach-Object { $_.GetAttribute('name') })
      $name = $leaf.GetAttribute('name')
      $segment = if ($leaf.LocalName -eq 'attribute') { "@$name" } else { $name }
      $path = ($parents + $segment) -join '/'
      $type = $leaf.GetAttribute('type')
      if (!$type) { $type = $leaf.SelectSingleNode('xs:simpleType/xs:restriction/@base', $namespace)?.Value }
      $mapping = 'No Orbit source mapping verified'
      if ($path -match '^Mcr/Rmla/SectionISection/(AC0(?:10|20|30|40|50|60|63|65|70|80))_([1-4])$') {
        $line = $Matches[1]
        $column = [int] $Matches[2]
        $channel = if ($column -le 2) { 'direct' } else { 'thirdParty' }
        $value = if ($column % 2) { 'amount' } else { 'count' }
        $mapping = if ($line -eq 'AC065') { "Workpaper input: $channel.$line" } else { "Workpaper input: $channel.$line.$value" }
      } elseif ($path -match '^Mcr/Rmla/SectionISection/(AC9[234]0)_([1-6])$') {
        $line = $Matches[1]
        $column = [int] $Matches[2]
        $channel = @('brokered', 'brokered', 'retail', 'retail', 'wholesale', 'wholesale')[$column - 1]
        $value = if ($column % 2) { 'amount' } else { 'count' }
        $mapping = "Funded review: channels[$channel].lines.$line.$value"
      } elseif ($path -match '^Mcr/Rmla/ListSectionOfSectionIMlosItem/DetailItemList/SectionIMlosItem/(ACMLO(?:_[23])?)$') {
        $value = @{ ACMLO = 'originator'; ACMLO_2 = 'amount'; ACMLO_3 = 'count' }[$Matches[1]]
        $mapping = "Funded review: originators[].$value"
      }
      [pscustomobject]@{ XmlPath = $path; Type = $type; Mapping = $mapping }
    }
    if (@($inventory | Where-Object Mapping -like 'Workpaper input:*').Count -ne 38) {
      throw 'The expected 38 application pipeline inputs did not match the pinned schema.'
    }
    if (@($inventory | Where-Object Mapping -like 'Funded review:*').Count -ne 21) {
      throw 'The expected 21 classification and MLO fields did not match the pinned schema.'
    }
    $inventory | Export-Csv -LiteralPath $FieldInventory -NoTypeInformation -Encoding utf8
    Write-Output "Inventoried $($inventory.Count) XSD leaves and attributes, including 38 pipeline inputs and 21 funded-review fields."
  } finally { $sampleZip.Dispose() }
} finally { $schemaZip.Dispose() }
