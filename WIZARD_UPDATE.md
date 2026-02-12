# Wizard Update Instructions

## Add These State Variables (after line 40):

```typescript
// Website Extraction
const [websiteUrl, setWebsiteUrl] = useState('');
const [extracting, setExtracting] = useState(false);

// Step 5: Sample Reply Testing
const [testResults, setTestResults] = useState<any[]>([]);
const [loadingTests, setLoadingTests] = useState(false);
const [testResultsLoaded, setTestResultsLoaded] = useState(false);
const [editedResponses, setEditedResponses] = useState<Record<number, string>>({});
```

## Add These Functions (after handleSubmit):

```typescript
// Website Extraction Function
const extractFromWebsite = async () => {
  if (!openaiApiKey) {
    alert('Please enter your OpenAI API key in Step 2 first');
    return;
  }

  setExtracting(true);
  try {
    const response = await fetch('/api/extract-website', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: websiteUrl,
        openai_api_key: openaiApiKey,
      }),
    });

    const data = await response.json();

    if (data.success) {
      setCompanyInfo(data.data.company_info || '');
      setProductDescription(data.data.product_description || '');
      setValueProps(data.data.value_propositions || ['']);
      alert('✓ Information extracted successfully!');
    } else {
      alert(`Failed: ${data.error}`);
    }
  } catch (error) {
    console.error('Extraction error:', error);
    alert('Failed to extract website information');
  } finally {
    setExtracting(false);
  }
};

// Fetch Test Results Function
const fetchTestResults = async () => {
  if (!emailbisonApiKey || !openaiApiKey) {
    alert('API keys are required');
    return;
  }

  setLoadingTests(true);
  try {
    const response = await fetch('/api/test-responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emailbison_api_key: emailbisonApiKey,
        openai_api_key: openaiApiKey,
        knowledge_base: {
          company_info: companyInfo,
          product_description: productDescription,
          value_propositions: valueProps.filter((v) => v.trim()),
          custom_instructions: customInstructions,
        },
      }),
    });

    const data = await response.json();

    if (data.success) {
      setTestResults(data.data);
      setTestResultsLoaded(true);

      if (data.data.length === 0) {
        alert('No interested replies found in your EmailBison workspace. You can proceed to create the agent.');
      }
    } else {
      alert(`Failed: ${data.error}`);
    }
  } catch (error) {
    console.error('Test error:', error);
    alert('Failed to fetch test responses');
  } finally {
    setLoadingTests(false);
  }
};
```

## Add to Step 3 (at the beginning of case 3, before timezone):

```typescript
{/* Website Extraction Section */}
<div className="rounded-md border-2 border-blue-200 bg-blue-50 p-4">
  <div className="mb-2 flex items-center gap-2">
    <span className="text-lg">🌐</span>
    <h3 className="font-semibold text-blue-900">Quick Setup: Extract from Website</h3>
  </div>
  <p className="mb-3 text-sm text-blue-700">
    Automatically extract company information from your website
  </p>
  <div className="flex gap-2">
    <Input
      placeholder="https://yourcompany.com"
      value={websiteUrl}
      onChange={(e) => setWebsiteUrl(e.target.value)}
      className="bg-white"
    />
    <Button
      type="button"
      onClick={extractFromWebsite}
      disabled={extracting || !websiteUrl || !openaiApiKey}
      variant="default"
    >
      {extracting ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Extracting...
        </>
      ) : (
        'Extract Info'
      )}
    </Button>
  </div>
  {!openaiApiKey && (
    <p className="mt-2 text-xs text-blue-600">
      ℹ️ Enter your OpenAI API key in Step 2 to use this feature
    </p>
  )}
</div>
```

## Replace Step 5 ENTIRELY with:

```typescript
case 5:
  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-2xl font-bold">Test with Sample Replies</h2>
        <p className="text-gray-600">
          Test your agent with real interested replies from EmailBison
        </p>
      </div>

      {!testResultsLoaded ? (
        <Card className="p-6">
          <div className="text-center">
            <p className="mb-4 text-sm text-gray-600">
              Click below to fetch up to 5 sample interested replies from your
              EmailBison workspace and see how the AI responds.
            </p>
            <Button
              onClick={fetchTestResults}
              disabled={loadingTests}
              size="lg"
            >
              {loadingTests ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Fetching Replies...
                </>
              ) : (
                'Fetch Sample Replies & Test'
              )}
            </Button>
          </div>
        </Card>
      ) : testResults.length === 0 ? (
        <Card className="p-6">
          <div className="text-center">
            <p className="mb-2 font-medium text-gray-900">
              No interested replies found
            </p>
            <p className="text-sm text-gray-600">
              Your EmailBison workspace doesn't have any interested replies yet.
              You can still create the agent and test it later.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md bg-green-50 p-3">
            <p className="text-sm text-green-900">
              ✓ Found {testResults.length} sample replies. Review and edit the
              AI-generated responses below:
            </p>
          </div>

          {testResults.map((result, idx) => (
            <Card key={idx} className="overflow-hidden">
              <CardHeader className="bg-gray-50">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">
                      From: {result.reply.from_name || result.reply.from_email}
                    </CardTitle>
                    <p className="mt-1 text-sm text-gray-600">
                      {result.reply.subject}
                    </p>
                  </div>
                  <Badge
                    variant={
                      result.confidence_score >= 8
                        ? 'default'
                        : result.confidence_score >= 6
                        ? 'secondary'
                        : 'destructive'
                    }
                  >
                    Confidence: {result.confidence_score}/10
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="mb-4">
                  <h4 className="mb-2 text-sm font-medium text-gray-700">
                    Their Message:
                  </h4>
                  <div className="rounded-md bg-gray-50 p-3">
                    <p className="text-sm text-gray-900">{result.reply.body}</p>
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-medium text-gray-700">
                      AI Generated Response:
                    </h4>
                    {editedResponses[idx] &&
                      editedResponses[idx] !== result.generated_response && (
                        <Badge variant="outline">✏️ Edited</Badge>
                      )}
                  </div>
                  <textarea
                    value={
                      editedResponses[idx] !== undefined
                        ? editedResponses[idx]
                        : result.generated_response
                    }
                    onChange={(e) => {
                      const newEdited = { ...editedResponses };
                      newEdited[idx] = e.target.value;
                      setEditedResponses(newEdited);
                    }}
                    rows={6}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="Edit the response if needed..."
                  />
                  {result.reasoning && (
                    <p className="mt-2 text-xs text-gray-500">
                      💡 AI Reasoning: {result.reasoning}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}

          <div className="rounded-md bg-blue-50 p-4">
            <p className="text-sm text-blue-900">
              <strong>Review Summary:</strong> {testResults.length} sample
              responses tested
              {Object.keys(editedResponses).length > 0 && (
                <> • {Object.keys(editedResponses).length} edited</>
              )}
            </p>
            <p className="mt-1 text-xs text-blue-700">
              Your edits will help the agent learn your preferred communication style.
            </p>
          </div>
        </div>
      )}

      {testResultsLoaded && (
        <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-white p-3">
          <input
            type="checkbox"
            id="skip-test"
            className="h-4 w-4"
          />
          <label htmlFor="skip-test" className="text-sm text-gray-700">
            I've reviewed the test results and I'm ready to create the agent
          </label>
        </div>
      )}
    </div>
  );
```

This update adds both features properly integrated into the wizard!
